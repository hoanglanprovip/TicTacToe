import { buildServer } from './app.js';
import { loadEnv } from './env.js';

const loaded = loadEnv();
const port = Number(process.env.PORT ?? 4000);

const app = await buildServer({ port });
const address = app.server.address();
const boundPort = typeof address === 'object' && address ? address.port : port;

app.log.info(`Tic Tac Toe đang chạy tại http://localhost:${boundPort}`);
if (loaded.JWT_SECRET) app.log.info('Đã nạp cấu hình từ file .env');
if (loaded.DB_PATH) app.log.info(`Dữ liệu lưu tại: ${loaded.DB_PATH}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app.close().finally(() => process.exit(0));
  });
}