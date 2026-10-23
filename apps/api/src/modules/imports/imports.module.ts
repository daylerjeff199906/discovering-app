import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ENV, type Env } from "../../config/env";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";

@Module({
  imports: [
    // Archivo en memoria con tope de tamaño y de partes: se valida y se descarta, nunca se escribe a disco.
    MulterModule.registerAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({ limits: { fileSize: env.IMPORT_MAX_BYTES, files: 1, fields: 8, fieldSize: 512, parts: 10 } }),
    }),
  ],
  controllers: [ImportsController],
  providers: [ImportsService],
})
export class ImportsModule {}
