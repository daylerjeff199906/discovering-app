import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { UsersController, UsersService } from "./users.controller";

@Module({ imports: [AuthModule], controllers: [UsersController], providers: [UsersService] })
export class UsersModule {}
