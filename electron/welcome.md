```mermaid
flowchart TD
  start(["Halt! Who would cross the Bridge of Death?"])
  cross(["You may cross. Off you go!"])
  gorge["Hurled into the Gorge of Eternal Peril"]
  facts[["Swallow Airspeed"]]
  welcome>"Welcome to MerScribe"]
  subgraph qs ["The Bridgekeeper's Three Questions"]
    q1{{"What is your name?"}}
    q2{{"What is your quest?"}}
    q3{{"What is the airspeed velocity of an unladen swallow?"}}
  end
  start --> q1
  q1 -->|"Sir Lancelot of Camelot"| q2
  q1 -->|"Um... I don't..."| gorge
  q2 -->|"To seek the Holy Grail"| q3
  q2 -->|"To, er... I forget"| gorge
  q3 -->|"About 24 mph"| cross
  q3 -->|"I don't know THAT!"| gorge
  q3 -->|"What do you mean? African or European?"| cross
  q3 -.->|"consult"| facts
  style start fill:#dbeafe,stroke:#3b82f6,color:#1e3a8a
  style cross fill:#dcfce7,stroke:#22c55e,color:#166534
  style gorge fill:#fee2e2,stroke:#ef4444,color:#991b1b
```

### Swallow Airspeed

| Swallow | Origin | Airspeed |
| --- | --- | --- |
| African | Non-migratory | ~24 mph |
| European | Migratory | Unknown |

### Swallow Airspeed — notes

The Bridgekeeper never says *which* swallow — so answer his question with a question, and it's **he** who gets flung into the gorge.

### Welcome to MerScribe

Welcome, brave knight! 🏰

This whole board is **one Markdown file** — edit it on the canvas or in the `.md`, and the two stay in sync.

- Press **N** or double-click to add a node
- Drag from a node's edge to connect two nodes
- Drop a note onto a node to attach it (like the one on the table)
- **Auto-arrange** in the toolbar tidies everything up

🤖 **Using an AI agent?** Point it at `merscribe-agent-guide.md` (saved next to this diagram) — it explains how to build and edit this board from the file.
