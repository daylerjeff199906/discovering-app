import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { ModerationController, ModerationService } from "../moderation/moderation.controller";
import { BookmarksController, PublicController, PublicationsController, ReportsController } from "./publications.controller";
import { PublicationsService } from "./publications.service";

@Module({
  imports: [MediaModule],
  controllers: [PublicationsController, PublicController, BookmarksController, ReportsController, ModerationController],
  providers: [PublicationsService, ModerationService],
})
export class PublicationsModule {}
