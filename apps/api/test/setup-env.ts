import "reflect-metadata";
import { setAdapterOverrides } from "../src/infrastructure/adapters";
import { applyTestEnv } from "./env";
import { fakeGoogle, memoryMailer, memoryStorage } from "./fakes";

applyTestEnv();
// Las pruebas no hablan con Cloudflare R2 ni con Resend: usan almacenamiento y correo en memoria.
setAdapterOverrides({ storage: memoryStorage, mailer: memoryMailer, google: fakeGoogle });
