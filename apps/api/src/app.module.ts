import { type DynamicModule, type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { CsrfGuard, RateLimitGuard, SessionGuard } from "./common/guards";
import { AllExceptionsFilter, RequestLogInterceptor, requestContext } from "./common/http";
import { ConfigModule } from "./config/config.module";
import { InfrastructureModule } from "./infrastructure/infrastructure.module";
import { AuthModule } from "./modules/auth/auth.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { JourneysModule } from "./modules/journeys/journeys.module";
import { MediaModule } from "./modules/media/media.module";
import { MetaModule } from "./modules/meta/meta.module";
import { PlacesModule } from "./modules/places/places.module";
import { PublicationsModule } from "./modules/publications/publications.module";
import { RecordingsModule } from "./modules/recordings/recordings.module";
import { UsersModule } from "./modules/users/users.module";

@Module({})
export class AppModule implements NestModule {
  /** `overrides` permite a las pruebas fijar variables de entorno por instancia de aplicación. */
  static forRoot(overrides: Record<string, string> = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [ConfigModule.forRoot(overrides), InfrastructureModule, AuthModule, UsersModule, MetaModule, PlacesModule, ImportsModule, JourneysModule, RecordingsModule, MediaModule, PublicationsModule],
      providers: [
        // Orden: CSRF → sesión (denegado por omisión salvo @Public) → límite de peticiones.
        { provide: APP_GUARD, useClass: CsrfGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_INTERCEPTOR, useClass: RequestLogInterceptor },
      ],
    };
  }

  configure(consumer: MiddlewareConsumer) {
    consumer.apply(requestContext).forRoutes("*path");
  }
}
