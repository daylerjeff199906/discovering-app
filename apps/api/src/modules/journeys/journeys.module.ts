import { Module } from "@nestjs/common";
import { PlacesModule } from "../places/places.module";
import { PlanningController } from "../planning/planning.controller";
import { PlanningService } from "../planning/planning.service";
import { JourneysController } from "./journeys.controller";
import { JourneysService } from "./journeys.service";

@Module({
  imports: [PlacesModule],
  controllers: [JourneysController, PlanningController],
  providers: [JourneysService, PlanningService],
  exports: [JourneysService],
})
export class JourneysModule {}
