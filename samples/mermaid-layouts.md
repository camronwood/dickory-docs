# Mermaid layout samples

Manual QA fixture for Dickory Docs layout renderers. Open this file in the app and confirm each diagram renders (preview, expand modal, diagram gallery).

## Dagre baseline (default)

```mermaid
flowchart LR
  A[Start] --> B[Process]
  B --> C[End]
```

## ELK via init directive

```mermaid
%%{init: {"flowchart": {"defaultRenderer": "elk"}} }%%
flowchart TD
  A[Service A] --> B[Service B]
  A --> C[Service C]
  B --> D[Database]
  C --> D
```

## ELK via YAML frontmatter (stress layout)

```mermaid
---
config:
  layout: elk.stress
---
flowchart TD
  Root --> Left
  Root --> Right
  Left --> Leaf1
  Right --> Leaf2
```

## flowchart-elk diagram type

```mermaid
flowchart-elk LR
  Client --> API
  API --> Worker
  Worker --> Store
```

## Tidy-tree mindmap

```mermaid
---
config:
  layout: tidy-tree
---
mindmap
  root((Product))
    Features
      Editor
      Preview
    Platform
      macOS
      Windows
      Linux
```
