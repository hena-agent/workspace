import { AgentV2 } from "@hena-agent/core/agent"
import { AISDK } from "@hena-agent/core/aisdk"
import { Catalog } from "@hena-agent/core/catalog"
import { CommandV2 } from "@hena-agent/core/command"
import { Credential } from "@hena-agent/core/credential"
import { AppNodeBuilder } from "@hena-agent/core/effect/app-node-builder"
import { LayerNodePlatform } from "@hena-agent/core/effect/app-node-platform"
import { LayerNode } from "@hena-agent/core/effect/layer-node"
import { EventV2 } from "@hena-agent/core/event"
import { FileSystem } from "@hena-agent/core/filesystem"
import { FSUtil } from "@hena-agent/core/fs-util"
import { Integration } from "@hena-agent/core/integration"
import { Location } from "@hena-agent/core/location"
import { Npm } from "@hena-agent/core/npm"
import { PluginV2 } from "@hena-agent/core/plugin"
import { Reference } from "@hena-agent/core/reference"
import { SkillV2 } from "@hena-agent/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
