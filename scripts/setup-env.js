#!/usr/bin/env node
import { createEnvFile } from "../src/config.js"

const envPath = process.argv[2] ?? ".env"
const result = await createEnvFile({ envPath })

console.log(`Configured environment file at ${result.envPath}`)
