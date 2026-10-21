import { Module } from "@nestjs/common";
import { MediaModule } from "../media/media.module";
import { PlacesModule } from "../places/places.module";
import { RecordingsController } from "./recordings.controller";
import { RecordingsService } from "./recordings.service";

@Module({ imports: [PlacesModule, MediaModule], controllers: [RecordingsController], providers: [RecordingsService] })
export class RecordingsModule {}
