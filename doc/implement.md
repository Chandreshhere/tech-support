### Refined, Structured Prompt

**Objective**
Design and implement an intelligent UI-navigation system that can understand a software application’s interface (using structured documentation), retrieve relevant context, and autonomously execute user tasks through an agent connected to a control layer (MCP).

---

## 1. UI Documentation Strategy (RAG Input Layer)

* Select a representative software application (e.g., Discord) as the reference system.
* Break down the entire application into **individual screens/pages**, covering the full user journey:

  * Authentication: login, signup, forgot password
  * Core interface: home, chat, servers, channels
  * User features: friends list, DMs
  * Configuration: account settings, server settings, privacy, etc.

### Documentation Rules

* Each screen must have its **own `.md` file**.

* Naming convention:
  `feature.screen.md` (e.g., `login.screen.md`, `home.screen.md`)

* Each file must be:

  * Short
  * Direct
  * Structured using bullet points
  * Strictly visual + functional (no unnecessary explanation)

### Example Format

**login.screen.md**

* Centered layout
* Two input fields:

  * Email
  * Password
* Below fields:

  * “Forgot Password” option
* Below that:

  * Login button

**home.screen.md**

* Left sidebar:

  * Displays list of servers (icons/logos)
  * Top: option to open friends list
  * Bottom: current user info + settings (gear icon)
* Right pane:

  * Displays selected content dynamically:

    * Server view
    * Channel chat
    * Friends list
    * Messages

### Coverage Requirement

* Every interactive screen/page must be documented similarly.
* Maintain consistency in structure across all files.

---

## 2. RAG System Design

* Store all `.md` files in a **vector database**.
* Each file represents:

  * One **independent retrieval unit (chunk)**
  * With associated **metadata** (screen name, feature category, etc.)

### Retrieval Behavior

* When queried, the system should:

  * Fetch only the **relevant screens**
  * Assemble them into a **step-by-step contextual flow**

---

## 3. Agent System (Execution Layer)

### Core Responsibilities

* Interpret user intent (e.g., “change email”)
* Query RAG for relevant UI steps
* Construct a **navigation and action plan**
* Execute actions via MCP:

  * Clicking
  * Typing
  * Scrolling
  * Navigating between screens

### Example Flow

User request: *Change account email*

RAG returns:

* Go to settings
* Navigate to “Account & Security”
* Locate email section
* Click “Change Email”
* Enter password (verification screen)
* Enter new email
* Confirm

Agent:

* Converts steps into executable actions
* Sequentially performs them using MCP

---

## 4. Multi-LLM Agent Architecture

### Model Strategy

* Use two LLMs:

  * **Primary (efficient): Groq**
  * **Secondary (high-quality): Gemini**

### Allocation Logic

* Groq:

  * Default model for most tasks
  * Handles standard reasoning and navigation

* Gemini:

  * Used selectively for:

    * Complex reasoning
    * Critical decision points
    * Ambiguous UI flows

### Constraints & Optimization

* Gemini has limited free-tier tokens:

  * Use sparingly
  * Reserve for high-impact steps

* Implement:

  * **Model fallback system**:

    * If Gemini quota is exhausted → fallback to Groq
  * **Multiple API key rotation**:

    * Prevent daily quota exhaustion
    * Ensure continuity

### Reference Implementation

* Study LLM setup (groq and gemini; key switching and model switching; using langchain) from:

  ```
  ~/Documents/Yatharthk/Kraken
  ```

---

## 5. System Integration Overview

### Pipeline

1. UI screens → documented as `.md`
2. `.md` files → embedded into vector DB
3. User query → sent to agent
4. Agent → retrieves context via RAG
5. RAG → returns relevant screen descriptions
6. Agent → constructs execution plan
7. MCP → executes actions on UI

---

## 6. Key Design Principles

* Keep documentation minimal but precise
* Maintain strict structural consistency
* Treat each screen as an independent unit
* Optimize for retrieval clarity, not human readability
* Prioritize deterministic, step-based navigation
* Ensure system robustness under API limits

---

## 7. End Goal

A system where:

* The UI is **understood via structured documentation**
* Context is **retrieved intelligently via RAG**
* Actions are **executed autonomously via an agent**
* The entire workflow mimics how a human navigates software—but is fully automated and scalable

