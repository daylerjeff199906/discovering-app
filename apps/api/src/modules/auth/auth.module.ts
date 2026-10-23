import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { AccountController, AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({ imports: [MediaModule], controllers: [AuthController, AccountController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
