import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { IngestController } from "./ingest.controller";

@Module({
	imports: [AgentModule],
	controllers: [IngestController],
})
export class IngestModule {}
