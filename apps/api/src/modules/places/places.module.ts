import { Module } from "@nestjs/common";
import { PlacesController } from "./places.controller";
import { PlacesService } from "./places.service";
import { CatalogController } from "./catalog.controller";

@Module({ controllers: [PlacesController, CatalogController], providers: [PlacesService], exports: [PlacesService] })
export class PlacesModule {}
