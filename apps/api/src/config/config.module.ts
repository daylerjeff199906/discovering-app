import { Global, Module, type DynamicModule } from "@nestjs/common";
import { ENV, parseEnv, type Env } from "./env";

@Global()
@Module({})
export class ConfigModule {
  /** `overrides` permite a las pruebas fijar variables sin tocar `process.env`. */
  static forRoot(overrides: Record<string, string> = {}): DynamicModule {
    const env: Env = parseEnv(process.env, overrides);
    return { module: ConfigModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] };
  }
}
