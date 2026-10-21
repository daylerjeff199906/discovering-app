import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { applyProposalInputSchema, proposalDtoSchema, proposalInputSchema, type ProposalInput } from "@por-aqui/contracts";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser } from "../../common/decorators";
import { PlanningService } from "./planning.service";

@ApiTags("planning")
@Controller("journeys/:id/proposals")
export class PlanningController {
  constructor(private readonly planning: PlanningService) {}

  @Post()
  @HttpCode(200)
  @Api({ summary: "Generar una propuesta determinista (sin LLM) a partir del catálogo; no modifica el viaje", body: proposalInputSchema, response: proposalDtoSchema })
  propose(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: ProposalInput) {
    return this.planning.propose(user, id, body);
  }

  @Post("apply")
  @HttpCode(200)
  @Api({ summary: "Aplicar la propuesta revisada (409 si el viaje cambió mientras se calculaba)", body: applyProposalInputSchema })
  apply(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: z.infer<typeof applyProposalInputSchema>) {
    return this.planning.apply(user, id, body.proposal, body.expectedVersion);
  }
}
