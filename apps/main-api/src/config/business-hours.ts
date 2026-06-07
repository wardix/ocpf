import { sql } from './database';

export interface BusinessHoursStatus {
  isOpen: boolean;
  oooMessage: string;
}

export async function isWithinBusinessHours(inboxId: number, queryContext = sql): Promise<BusinessHoursStatus> {
  // Retrieve settings
  const [settings] = await queryContext`
    SELECT business_hours_enabled, timezone, out_of_office_message
    FROM inbox_settings
    WHERE inbox_id = ${inboxId}
    LIMIT 1
  `;

  if (!settings) {
    // If no settings exist, default to open
    return { isOpen: true, oooMessage: '' };
  }

  if (!settings.business_hours_enabled) {
    return { isOpen: true, oooMessage: '' };
  }

  const timezone = settings.timezone || 'Asia/Jakarta';
  const oooMessage = settings.out_of_office_message || 'Terima kasih telah menghubungi kami. Saat ini di luar jam operasional, kami akan merespons pada jam kerja berikutnya.';

  // Get current date/time in the target timezone
  const date = new Date();

  // Find English weekday name
  const weekdayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
  });
  const weekdayName = weekdayFormatter.format(date).toLowerCase();

  const weekdayMap: Record<string, number> = {
    'sunday': 0,
    'monday': 1,
    'tuesday': 2,
    'wednesday': 3,
    'thursday': 4,
    'friday': 5,
    'saturday': 6,
  };
  const dayOfWeek = weekdayMap[weekdayName];

  // Find hour, minute, second
  const timeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = timeFormatter.formatToParts(date);
  const hourVal = parts.find(p => p.type === 'hour')?.value || '00';
  const minuteVal = parts.find(p => p.type === 'minute')?.value || '00';
  const secondVal = parts.find(p => p.type === 'second')?.value || '00';

  let h = parseInt(hourVal, 10);
  if (h === 24) h = 0;
  const m = parseInt(minuteVal, 10);
  const s = parseInt(secondVal, 10);

  const currentSeconds = h * 3600 + m * 60 + s;

  // Retrieve schedule for the current day of week
  const [schedule] = await queryContext`
    SELECT open_time, close_time, is_closed
    FROM business_hours
    WHERE inbox_id = ${inboxId} AND day_of_week = ${dayOfWeek}
    LIMIT 1
  `;

  // Default schedule: Mon-Sun 08:00 - 17:00, not closed
  let openTimeStr = '08:00:00';
  let closeTimeStr = '17:00:00';
  let isClosed = false;

  if (schedule) {
    openTimeStr = schedule.open_time;
    closeTimeStr = schedule.close_time;
    isClosed = !!schedule.is_closed;
  }

  if (isClosed) {
    return { isOpen: false, oooMessage };
  }

  const [openH, openM, openS] = openTimeStr.split(':').map(Number);
  const [closeH, closeM, closeS] = closeTimeStr.split(':').map(Number);

  const openSeconds = openH * 3600 + openM * 60 + (openS || 0);
  const closeSeconds = closeH * 3600 + closeM * 60 + (closeS || 0);

  // standard comparison
  const isOpen = currentSeconds >= openSeconds && currentSeconds <= closeSeconds;

  return { isOpen, oooMessage };
}
