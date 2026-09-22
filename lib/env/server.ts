import 'server-only'
import { parseEnv, serverEnvSchema } from './schema'

export const serverEnv = parseEnv(serverEnvSchema, process.env)
