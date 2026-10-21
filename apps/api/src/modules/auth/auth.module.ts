import { Module } from "@nestjs/common";
import { AccountController, AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";

@Module({ controllers: [AuthController, AccountController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
