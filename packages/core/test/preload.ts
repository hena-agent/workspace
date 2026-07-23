import path from "path"

process.env.HENA_AGENT_DB = ":memory:"
process.env.HENA_AGENT_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.HENA_AGENT_DISABLE_MODELS_FETCH = "true"
