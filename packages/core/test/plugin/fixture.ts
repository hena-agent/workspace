import { AgentV2 } from "@hena/core/agent"
import { AISDK } from "@hena/core/aisdk"
import { Catalog } from "@hena/core/catalog"
import { CommandV2 } from "@hena/core/command"
import { Credential } from "@hena/core/credential"
import { AppNodeBuilder } from "@hena/core/effect/app-node-builder"
import { LayerNodePlatform } from "@hena/core/effect/app-node-platform"
import { LayerNode } from "@hena/core/effect/layer-node"
import { EventV2 } from "@hena/core/event"
import { FileSystem } from "@hena/core/filesystem"
import { FSUtil } from "@hena/core/fs-util"
import { Integration } from "@hena/core/integration"
import { Location } from "@hena/core/location"
import { Npm } from "@hena/core/npm"
import { PluginV2 } from "@hena/core/plugin"
import { Reference } from "@hena/core/reference"
import { SkillV2 } from "@hena/core/skill"
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
