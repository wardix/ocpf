import { sql } from '../config/database';
import { redisWorker, redis } from '../config/redis';
import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';

const EXPORTS_DIR = path.resolve(process.cwd(), 'exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

async function processExportJob(jobStr: string) {
  const { jobId, accountId } = JSON.parse(jobStr);

  const [job] = await sql`SELECT * FROM export_jobs WHERE id = ${jobId} AND account_id = ${accountId}`;
  if (!job || job.status !== 'queued') return;

  await sql`UPDATE export_jobs SET status = 'processing' WHERE id = ${jobId}`;
  publishEvent(accountId, { type: 'export.started', payload: { jobId } });

  try {
    const filters = job.filters || {};
    const format = job.export_format;
    const exportType = job.export_type; // 'conversations', 'contacts', etc.
    const BATCH_SIZE = 500;
    
    // Determine total count based on type
    let totalQuery = sql`SELECT COUNT(*) FROM conversations WHERE account_id = ${accountId}`;
    if (exportType === 'contacts') {
      totalQuery = sql`SELECT COUNT(*) FROM contacts WHERE account_id = ${accountId}`;
    }

    const [{ count }] = await totalQuery;
    const totalRows = parseInt(count, 10);

    if (totalRows === 0) {
      await sql`UPDATE export_jobs SET status = 'completed', progress_percent = 100, row_count = 0 WHERE id = ${jobId}`;
      publishEvent(accountId, { type: 'export.completed', payload: { jobId } });
      return;
    }

    const filename = \`export_\${exportType}_\${accountId}_\${Date.now()}.\${format}\`;
    const filePath = path.join(EXPORTS_DIR, filename);

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Data');

    if (exportType === 'conversations') {
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Contact ID', key: 'contact_id', width: 15 },
        { header: 'Status', key: 'status', width: 15 },
        { header: 'Channel', key: 'channel_id', width: 15 },
        { header: 'Created At', key: 'created_at', width: 25 },
        { header: 'Resolved At', key: 'resolved_at', width: 25 },
      ];
    } else if (exportType === 'contacts') {
      worksheet.columns = [
        { header: 'ID', key: 'id', width: 10 },
        { header: 'Name', key: 'name', width: 25 },
        { header: 'Phone', key: 'phone_number', width: 20 },
        { header: 'Email', key: 'email', width: 25 },
        { header: 'Created At', key: 'created_at', width: 25 },
      ];
    }

    let processedRows = 0;
    for (let offset = 0; offset < totalRows; offset += BATCH_SIZE) {
      let dataQuery;
      if (exportType === 'conversations') {
        dataQuery = sql\`
          SELECT id, contact_id, status, channel_id, created_at, resolved_at 
          FROM conversations 
          WHERE account_id = \${accountId}
          ORDER BY id ASC
          LIMIT \${BATCH_SIZE} OFFSET \${offset}
        \`;
      } else {
        dataQuery = sql\`
          SELECT id, name, phone_number, email, created_at
          FROM contacts
          WHERE account_id = \${accountId}
          ORDER BY id ASC
          LIMIT \${BATCH_SIZE} OFFSET \${offset}
        \`;
      }

      const rows = await dataQuery;
      
      rows.forEach((row: any) => {
        worksheet.addRow(row);
      });

      processedRows += rows.length;
      const progress = Math.floor((processedRows / totalRows) * 100);
      
      await sql`UPDATE export_jobs SET progress_percent = ${progress} WHERE id = ${jobId}`;
      publishEvent(accountId, { type: 'export.progress', payload: { jobId, progress } });
    }

    if (format === 'csv') {
      await workbook.csv.writeFile(filePath);
    } else {
      await workbook.xlsx.writeFile(filePath);
    }

    const stat = fs.statSync(filePath);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

    await sql`
      UPDATE export_jobs SET 
        status = 'completed', 
        progress_percent = 100,
        row_count = ${processedRows},
        file_path = ${filePath},
        file_size_bytes = ${stat.size},
        expires_at = ${expiresAt.toISOString()}
      WHERE id = ${jobId}
    `;

    publishEvent(accountId, { type: 'export.completed', payload: { jobId } });

  } catch (error) {
    console.error('Export job failed:', error);
    await sql`UPDATE export_jobs SET status = 'failed' WHERE id = ${jobId}`;
    publishEvent(accountId, { type: 'export.failed', payload: { jobId } });
  }
}

function publishEvent(accountId: string | number, event: any) {
  redis.publish(\`chat:events:\${accountId}\`, JSON.stringify(event));
}

// Cleanup expired exports (Runs occasionally)
let lastCleanup = Date.now();
async function runCleanup() {
  const now = Date.now();
  if (now - lastCleanup < 60 * 60 * 1000) return; // run once an hour
  lastCleanup = now;

  try {
    const expiredJobs = await sql`SELECT id, file_path FROM export_jobs WHERE expires_at < NOW() AND status = 'completed'`;
    for (const job of expiredJobs) {
      if (job.file_path && fs.existsSync(job.file_path)) {
        fs.unlinkSync(job.file_path);
      }
      await sql`UPDATE export_jobs SET status = 'expired', file_path = NULL WHERE id = ${job.id}`;
    }
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
}

async function startExportWorker() {
  console.log('[ExportWorker] Starting...');
  while (true) {
    try {
      const result = await redisWorker.brpop('queue:export_jobs', 5);
      if (result) {
        const [, jobStr] = result;
        await processExportJob(jobStr);
      }
      await runCleanup();
    } catch (err) {
      console.error('[ExportWorker] Error:', err);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

export { startExportWorker };
