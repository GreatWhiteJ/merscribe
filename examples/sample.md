```mermaid
flowchart TD
  start(["Which bear is best?"])
  q1(["Beets growing nearby?"])
  black["Panda Bear"]
  brown["Brown Bear"]
  done(["Best bear chosen"])
  facts[["Bear Comparison"]]
  q3(["Battlestar Galactica fan?"])
  start --> q1
  q1 -->|"Yes"| black
  q3 -->|"Yes"| black
  q3 -->|"No"| brown
  black --> done
  brown --> done
  facts --> start
  q1 -->|"No"| q3
```

### Bear Comparison

| Bear | Strength | Specialty |
| --- | --- | --- |
| Black Bear | High | Identity theft |
| Brown Bear | Medium | Catching salmon |
| Panda | Low | Looking cute |

### Bear Comparison — notes

Remember
- Bears, beets, Battlestar Galactica.
- When in doubt, pick the **Black Bear**.