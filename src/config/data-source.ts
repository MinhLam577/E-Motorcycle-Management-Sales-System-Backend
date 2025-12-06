// src/data-source.ts
import { DataSource, DataSourceOptions } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { join } from 'path';

// Load .env trước khi dùng (rất quan trọng khi chạy CLI)
config();

// Tạo config đúng chuẩn DataSourceOptions (không dùng registerAs)
const dataSourceOptions = {
  type: 'postgres' as const, // bắt buộc phải có và là const
  url: `${process.env.DATABASE_URL}`,
  // Tự động load entities & migrations (hỗ trợ cả dev và prod)
  entities: [join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [join(__dirname, '..', 'migrations', '*.{ts,js}')],
  ssl: false,
  logging: true,
  synchronize: false,
  migrationsRun: false,
  // Các option NestJS hay dùng nhưng DataSource cũng hỗ trợ
  autoLoadEntities: true,
  keepConnectionAlive: true,
};

const dataSource = new DataSource(dataSourceOptions as DataSourceOptions);

export default dataSource;
