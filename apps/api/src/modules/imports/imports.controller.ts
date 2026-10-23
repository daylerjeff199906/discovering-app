import { Body, Controller, HttpCode, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiBody, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { IMPORT_ERROR_CODES, importOptionsSchema, type ImportOptions, type ImportPreview, type ImportResult } from "@por-aqui/contracts";
import { Api, type AuthUser, CurrentUser, RateLimit } from "../../common/decorators";
import { AppError } from "../../common/errors";
import { parseOrThrow } from "../../common/zod-input.interceptor";
import { cleanFileName, ImportsService } from "./imports.service";

/** Lo mínimo que usamos del archivo que entrega multer (almacenamiento en memoria). */
interface UploadedBuffer {
  originalname: string;
  size: number;
  buffer: Buffer;
}

const multipartSpec = {
  type: "object",
  required: ["file"],
  properties: {
    file: { type: "string", format: "binary", description: "GPX, KML, JSON o CSV (máximo IMPORT_MAX_BYTES)" },
    title: { type: "string" },
    timezone: { type: "string", example: "America/Lima" },
    importWaypoints: { type: "string", enum: ["true", "false"] },
    from: { type: "string", format: "date-time" },
    to: { type: "string", format: "date-time" },
    startAt: { type: "string", format: "date-time", description: "Para archivos sin fechas" },
  },
} as const;

function readUpload(file: UploadedBuffer | undefined, body: unknown): { buffer: Buffer; name: string | null; options: ImportOptions } {
  if (!file?.buffer) throw new AppError(400, IMPORT_ERROR_CODES.NO_FILE, "Elige un archivo GPX, KML, JSON o CSV para importar.");
  return { buffer: file.buffer, name: cleanFileName(file.originalname), options: parseOrThrow(importOptionsSchema, { ...(body as object) }) };
}

@ApiTags("imports")
@Controller("journeys/import")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post("preview")
  @HttpCode(200)
  @RateLimit({ key: "import", limit: 60, windowSec: 600 })
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: multipartSpec as never })
  @Api({ summary: "Vista previa de un archivo GPX/KML/Takeout: puntos, distancia, fechas y lugares; no guarda nada" })
  preview(@UploadedFile() file: UploadedBuffer | undefined, @Body() body: unknown): ImportPreview {
    const { buffer, name, options } = readUpload(file, body);
    return this.imports.preview(buffer, options, name);
  }

  @Post()
  @HttpCode(201)
  @RateLimit({ key: "import", limit: 60, windowSec: 600 })
  @UseInterceptors(FileInterceptor("file"))
  @ApiConsumes("multipart/form-data")
  @ApiBody({ schema: multipartSpec as never })
  @Api({ summary: "Importar un recorrido: crea un viaje libre finalizado con trayecto GPS y visitas", status: 201 })
  import(@CurrentUser() user: AuthUser, @UploadedFile() file: UploadedBuffer | undefined, @Body() body: unknown): Promise<ImportResult> {
    const { buffer, name, options } = readUpload(file, body);
    return this.imports.import(user, buffer, options, name);
  }
}
