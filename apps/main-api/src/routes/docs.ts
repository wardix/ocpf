import { Hono } from 'hono';
import { swaggerUI } from '@hono/swagger-ui';

const app = new Hono();

const openApiSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Omnichannel Customer Support API',
    version: '1.0.0',
    description: 'API Dokumentasi untuk platform Omnichannel Customer Support.',
  },
  servers: [
    {
      url: 'http://localhost:8000',
      description: 'Local Development Server',
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
    },
  },
  security: [
    {
      BearerAuth: [],
    },
  ],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login agen atau administrator',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Berhasil login mengembalikan JWT token' },
          '401': { description: 'Kredensial tidak valid' },
        },
      },
    },
    '/api/contacts': {
      get: {
        tags: ['Contacts'],
        summary: 'Ambil daftar pelanggan (CRM)',
        parameters: [
          { name: 'q', in: 'query', schema: { type: 'string' }, description: 'Search keyword' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'per_page', in: 'query', schema: { type: 'integer', default: 25 } },
        ],
        responses: {
          '200': { description: 'Daftar kontak dengan paginasi' },
        },
      },
    },
    '/api/contacts/{id}': {
      patch: {
        tags: ['Contacts'],
        summary: 'Ubah data pelanggan',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Kontak berhasil diubah' },
        },
      },
    },
    '/api/conversations': {
      get: {
        tags: ['Conversations'],
        summary: 'Ambil daftar percakapan',
        parameters: [
          { name: 'tab', in: 'query', schema: { type: 'string', enum: ['unassigned', 'mine', 'assigned', 'all'] }, default: 'unassigned' },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'per_page', in: 'query', schema: { type: 'integer', default: 25 } },
        ],
        responses: {
          '200': { description: 'Daftar percakapan' },
        },
      },
    },
    '/api/conversations/start': {
      post: {
        tags: ['Conversations'],
        summary: 'Mulai obrolan Outbound (Tanpa tiket)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['phone_number'],
                properties: {
                  phone_number: { type: 'string' },
                  name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Percakapan berhasil dimulai' },
        },
      },
    },
    '/api/conversations/info/{id}': {
      get: {
        tags: ['Conversations'],
        summary: 'Ambil info tiket spesifik (Deep linking)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Data tiket' },
        },
      },
    },
    '/api/conversations/by-phone/{phone}': {
      get: {
        tags: ['Conversations'],
        summary: 'Ambil info tiket berdasarkan nomor WA',
        parameters: [
          { name: 'phone', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Data tiket' },
        },
      },
    },
    '/api/conversations/{id}/messages': {
      get: {
        tags: ['Conversations'],
        summary: 'Ambil histori pesan',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' }, description: 'Conversation ID' },
          { name: 'before', in: 'query', schema: { type: 'integer' }, description: 'Cursor pagination (message ID)' },
        ],
        responses: {
          '200': { description: 'List pesan' },
        },
      },
    },
    '/api/conversations/{id}/status': {
      patch: {
        tags: ['Conversations'],
        summary: 'Update status tiket (mis. Tutup Tiket)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['status'],
                properties: {
                  status: { type: 'string', enum: ['open', 'pending', 'snoozed', 'resolved'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Status berhasil diubah' },
        },
      },
    },
    '/api/conversations/{id}/assign': {
      patch: {
        tags: ['Conversations'],
        summary: 'Ambil alih tiket ke diri sendiri',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
    },
    '/api/conversations/{id}/unassign': {
      patch: {
        tags: ['Conversations'],
        summary: 'Lepas tiket ke antrean',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
    },
    '/api/messages/send': {
      post: {
        tags: ['Messages'],
        summary: 'Kirim pesan ke WA (bisa berupa lampiran)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['target_id', 'conversation_id'],
                properties: {
                  target_id: { type: 'string', description: 'Nomor WA tujuan' },
                  content: { type: 'string' },
                  conversation_id: { type: 'integer' },
                  is_private: { type: 'boolean' },
                  media: {
                    type: 'object',
                    properties: {
                      mimetype: { type: 'string' },
                      data_base64: { type: 'string' },
                      filename: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Pesan dikirim' },
        },
      },
    },
    '/api/users': {
      get: {
        tags: ['Users'],
        summary: 'Daftar semua pengguna / agen',
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
      post: {
        tags: ['Users'],
        summary: 'Buat agen baru (Admin Only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'email', 'password', 'role'],
                properties: {
                  name: { type: 'string' },
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  role: { type: 'string', enum: ['administrator', 'agent'] },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Agen dibuat' },
        },
      },
    },
    '/api/canned-responses': {
      get: {
        tags: ['Canned Responses'],
        summary: 'Daftar balasan cepat',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'per_page', in: 'query', schema: { type: 'integer', default: 25 } },
        ],
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
      post: {
        tags: ['Canned Responses'],
        summary: 'Tambah balasan cepat (Admin Only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['short_code', 'content'],
                properties: {
                  short_code: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
    },
    '/api/canned-responses/{id}': {
      put: {
        tags: ['Canned Responses'],
        summary: 'Ubah balasan cepat (Admin Only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['short_code', 'content'],
                properties: {
                  short_code: { type: 'string' },
                  content: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
      delete: {
        tags: ['Canned Responses'],
        summary: 'Hapus balasan cepat (Admin Only)',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
    },
    '/api/analytics': {
      get: {
        tags: ['Analytics'],
        summary: 'Dapatkan statistik dashboard (Admin Only)',
        responses: {
          '200': { description: 'Berhasil' },
        },
      },
    },
    '/api/broadcast': {
      post: {
        tags: ['Broadcast'],
        summary: 'Kirim pesan massal (Admin Only)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['contact_ids', 'content'],
                properties: {
                  contact_ids: { type: 'array', items: { type: 'integer' } },
                  content: { type: 'string' },
                  inbox_id: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Pesan massal dimasukkan ke antrean' },
        },
      },
    },
  },
};

app.get('/openapi.json', (c) => c.json(openApiSpec));
app.get('/', swaggerUI({ url: '/api/docs/openapi.json' }));

export default app;