import type { ProviderDef } from "../core/types.js";
import { bale } from "./bale.js";
import { eitaa } from "./eitaa.js";
import { rubika } from "./rubika.js";
import { soroush } from "./soroush.js";

export const builtinProviders: ProviderDef[] = [bale, eitaa, rubika, soroush];

export { bale, eitaa, rubika, soroush };
