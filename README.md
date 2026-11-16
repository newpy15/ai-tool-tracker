<div align="center">

**English** · [한국어](README.ko.md)

# ai-tool-tracker

### See which tools made it. Find the ones you need. Switch off the ones you don't.

**A side panel for Claude Code that shows, in real time, which plugins and skills you use, suggests tools for what you want to build, and lets you turn plugins off with a button.**

[![MIT license](https://img.shields.io/github/license/newpy15/ai-tool-tracker?style=flat-square)](LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/newpy15/ai-tool-tracker?style=flat-square)](https://github.com/newpy15/ai-tool-tracker/commits/main)
[![Claude Code plugin](https://img.shields.io/badge/Claude_Code-plugin-5c4ee5?style=flat-square)](#quick-start)

[Quick start](#quick-start) · [How it works](#how-it-works) · [What you can see](#what-you-can-see) · [Can I trust the suggested links?](#can-i-trust-the-suggested-links) · [Cautions](#cautions) · [FAQ](#when-something-goes-wrong) · [Contributing](#contributing)

</div>

> [!IMPORTANT]
> The official source is [newpy15/ai-tool-tracker](https://github.com/newpy15/ai-tool-tracker). A similar repository name or a copied README does not make a download official. Check the owner before you install anything, which is the same advice this plugin gives for every suggestion it shows.

---

## Why I made it

AI coding feels overwhelming at first. Three things bothered me:

1. It is hard to tell **which tool was used for which part** of what I built. I would like to look back and see "the video was made with Remotion", but there is no record.
2. I don't really know **which plugins exist or what each one is for**. When I say "make me a video", I wished someone would point out tools worth trying first.
3. Installed plugins and skills put their descriptions in front of the AI on every turn, even when you don't use them, and that costs tokens. I wanted to switch off the ones I don't use.

So I built a panel that "shows the tools you used, helps you find the ones you need, and lets you switch off the ones you don't". I am publishing it on GitHub so that beginners can find plugins easily and we can share bugs and improvements. I built it in conversation with Claude Code and fixed things by checking on a real PC.

## What I paid attention to

- **Beginner-friendly**: a Korean and English screen, a one-line description for every tool, and a glossary. Japanese, Chinese, Spanish, French and German can be chosen too.
- **Whether a suggested link can be trusted**: every suggestion shows its source tier and owner, and names, addresses and descriptions written by other people are never trusted as they are. (See "Can I trust the suggested links?" below.)
- **Transparency**: everything it reads, sends over the internet and changes is written down. Nothing is sent or installed automatically.
- **Tokens**: no model is used to scan files. A model is used only for translation (the lowest tier), and translations are saved so they are not repeated.
- **Careful actions**: deleting and moving go through a confirmation. The plugin cannot switch itself off. It checks once more right before deleting.
- **Different setups on different PCs**: it finds your config folder even if it lives somewhere else (`CLAUDE_CONFIG_DIR`, another drive). The **Environment** tab shows what it read.
- **Tests**: the safety rules have their own test file (7 tests) and were checked against all 3,700+ entries of the real directory.

## Quick start

Install it in Claude Code in a terminal:

```
/plugin install ai-tool-tracker --marketplace newpy15/ai-tool-tracker
```

Or in a shell (Command Prompt, PowerShell and so on):

```
claude plugin install ai-tool-tracker --marketplace newpy15/ai-tool-tracker
```

`/plugin` does not work in the desktop app, so there: click **+** next to the input box → **Plugins** → **Add marketplace**, enter `newpy15/ai-tool-tracker` → **Add plugin**.

- When asked "Add marketplace?" answer `y`. For the scope, the first one (user) is usually right.
- Right after installing you may see a note that "1 setting (language) is not set yet". It works with the default (Korean), so you can leave it, and you can change the language later in the **Environment** tab of the panel.
- It becomes active as soon as it is installed. If you don't see the panel, type `/ai-tools` in the input box. If it still doesn't show up, quit Claude Code completely and start it again.

### Say what you want to build

```text
Make a video and a pdf for me.
```

The panel notices the topics (video, documents) and lists matching tools in the **Suggestions** tab. Replace the sentence with what you want to build.

### Commands

| Input | What it does |
| --- | --- |
| `/ai-tools` | Opens the panel and re-reads the installed tools. Type it once after installing or removing a plugin. |
| `/ai-find video production` | Finds tools for the feature you want. It searches both the directory on your PC and GitHub, and the results appear in the **Suggestions** tab. With several topics (`video pdf`) it shows each topic separately. |
| `/ai-log image-tool logo draft` | Records a tool you used outside Claude Code by hand. (Tools used outside cannot be detected automatically.) |

- If you say something with a topic in it during a normal conversation, like "make me a video" or "make a pdf", a notification appears and results pile up in the **Suggestions** tab. This reads only the directory on your PC. The same topic is announced at most once every 10 minutes, and nothing is announced if you already have everything that matched.
- **Suggestions never install anything for you.** They only copy an install command. Every item shows its source tier and owner, so read "Can I trust the suggested links?" below and check the code and permissions yourself before installing.

### Your first 5 minutes

1. **Install**: install it as described above.
2. **Open the panel**: the panel opens automatically when you start. If you don't see it, type `/ai-tools`.
3. **Look at the Tools tab**: switch between the `Plugins` and `Skills` buttons and read what is installed on your PC and what each item does. Click a name to expand what is inside.
4. **Work as usual**: while you work, open the **Live log** tab to see the tools that were just used, stacked by kind.
5. **Find tools**: say what you want to build (`make me a video`), or type `/ai-find video production`, then look at the **Suggestions** tab.

### When you want to...

| What you want to do | How |
| --- | --- |
| See which tools were just used | the **Live log** tab |
| Understand what a plugin does | the **Tools** tab, click its name to expand it |
| Switch off plugins you don't use, to cut tokens | the **Tools** tab → the `Turn off` button on the plugin's row (see "Cautions" below) |
| Find tools for what you want to build | say it, or `/ai-find what you want` → the **Suggestions** tab |
| Change the screen language | the language buttons at the top of the **Environment** tab |
| The list didn't change after installing or removing a plugin | `/ai-tools` |
| Record a tool you used outside Claude Code | `/ai-log tool-name what-you-did` |

## How it works

ai-tool-tracker is a Claude Code plugin made of one hooks module. It **watches** what Claude Code does, keeps a short record, and **draws** a panel. It never changes what Claude does: its hooks always pass the call or the prompt on unchanged, and if the plugin itself fails, Claude Code carries on as if it were not there.

```text
  Claude Code
  ┌────────────────────────────────────────────────────────────┐
  │  you type a request ───► prompt.submit ──┐                 │
  │  Claude uses a tool ───► tool.call ──────┼──► panel state  │
  │  you type /ai-tools … ─► command.run ────┘        │        │
  └───────────────────────────────────────────────────┼────────┘
                                                      ▼
   read only                                   ┌─────────────┐
   ~/.claude: installed plugins, skills,  ───► │  ui.render  │ ───► the panel (4 tabs)
   settings, plugin directory cache            └─────────────┘
                                                      ▲
   only when you press a button or type /ai-find      │
   one search word ───► api.github.com ───► trust check ──► Suggestions
```

### The pieces

| Piece | File | What it does |
| --- | --- | --- |
| Hooks module | `hooks/register.tsx` | Registers the hooks below, reads your installed tools, draws the panel and runs the buttons. |
| Trust rules | `hooks/trust.ts` | Pure functions that clean text written by other people, make safe names, commands and links, decide the source tier, and raise caution flags. No Claude Code needed to test them. |
| State types | `types/index.d.ts` | The shape of what the panel keeps (log, tabs, suggestions). |
| Tests | `test/trust.test.mjs` | The safety rules, run with `node --test test/`. |
| Install files | `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` | What `claude plugin install … --marketplace newpy15/ai-tool-tracker` reads. |

### What each hook does

| Hook | When it runs | What it does | Passes the call on unchanged? |
| --- | --- | --- | --- |
| `session.start` | Claude Code starts | Registers `/ai-tools`, `/ai-find`, `/ai-log`, opens the panel, reads your installed plugins and skills, and starts any translation that is missing. | – |
| `prompt.submit` | You send a message | Looks for topic words from a built-in dictionary (14 topics, at most 3 per message) and searches the local directory. **The text itself is not kept.** | Yes |
| `tool.call` | Claude uses a tool or skill | Records the tool's name and a short detail in the log (for example a file name, a command description or a search word). Reading and searching tools such as `Read` and `Grep` are not recorded. | Yes |
| `command.run` | You type one of the three commands | Re-reads the tools, searches directory and GitHub, or adds a hand-made log entry. | – |
| `ui.render` | The panel needs drawing | Draws the four tabs from the saved state. If drawing fails it shows an error line instead of a blank panel. | – |

### Where the information comes from

- **Installed tools**: the plugins' own files in Claude's config folder (`installed_plugins.json`, each `SKILL.md` header, `plugin.json`, agent and MCP files) and your `settings.json` for what is switched on. Nothing is guessed.
- **Descriptions**: taken from each tool's own description. For a dozen popular tools (such as Remotion, Figma and Notion) there is also a short hand-written description in the log.
- **Suggestions**: the plugin directory file stored on your PC and the marketplaces you added, plus GitHub search when you ask for it.
- **Translations**: the Korean and English screens are written by hand. Other languages are translated once by a model (the lowest tier), checked (right alphabet, placeholders intact), and saved together with the English original, so a changed sentence is translated again and an unchanged one never is.

### How one suggestion is made

1. A topic is recognized from a dictionary (for example "video", "pdf", "slides").
2. The directory on your PC and the marketplaces you added are searched. Results are ranked by how well they match, with a small bonus for a more verified source.
3. Only if you press the button (or type `/ai-find`), GitHub is searched by topic (`claude-code-plugin`, `claude-skills`, `claude-code`) and the results are merged. Only one search word is sent.
4. Every result goes through the trust check (below): its source tier, owner and caution flags are decided, and its link and install command are rebuilt from verified parts.
5. The Suggestions tab shows the result. Nothing is installed.

### What is kept, and where

- **The log and the panel's state** (which tab is open, the last suggestions) live in Claude Code's session state for this plugin. They are never sent anywhere.
- **Translations** are cached across sessions so they are not repeated.
- **Your files change only through buttons you press.** Switching plugins on or off and installing use the `claude` command. "Move to global" copies a folder-only skill into `~/.claude/skills` (or a session-only mod into `~/.claude/local-mods`), and "Remove old cache" and "Delete original" delete folders, each after a confirmation.

## What you can see

The panel has four tabs.

| Tab | What it does |
| --- | --- |
| **Tools** | Shows the **plugins** and **skills** installed on your PC with descriptions. Plugins can be turned on and off, and clicking a name expands the skills, agents and MCP servers inside it. For skills it also shows how to call them with `/name`. |
| **Live log** | Stacks the tools used while you work (skills, plugins, file edits, commands, subagents and so on) in time order, grouped by kind, with a one-line description of "what this tool is for". |
| **Suggestions** | When you say something like "make a video and a pdf", it recognizes the topic (video, documents, ...) and shows matching tools per topic. It searches the plugin directory stored on your PC first, and when you press a button it searches GitHub live for more. |
| **Environment** | Language choice, what it read on your PC ("Detected environment"), translation progress, removing old cached versions, and moving tools that only work in one folder to global. |

### Example: "make a video and a pdf"

What the **Suggestions** tab lists, in two groups (an illustration computed with the same ranking rules from the plugin directory on the author's PC on 2026-11-16; it is not an endorsement, and anything you already have installed is tagged `installed`):

```text
Video  (search: video, remotion, animation, motion)
  Remotion                              [Listed in directory · not reviewed]  Owner: remotion-dev
  AI Video Editor & Timeline            [Listed in directory · not reviewed]  Owner: clipwave-io
  video-shotcraft                       [Listed in directory · not reviewed]  Owner: vincentwei1021
  Motion Reel                           [Listed in directory · not reviewed]  Owner: aries-spring

Documents  (search: pdf, docx, xlsx)
  PDF Viewer                            [Reviewed by Anthropic]               Owner: anthropics
  DevExpress Office & PDF File API      [Reviewed (partner)]                  Owner: devexpress
  carbone-skill                         [Official marketplace]                Owner: carboneio
  Pdf To Excel                          [Listed in directory · not reviewed]  Owner: cavada76
```

Each row also has the description, caution flags, an `Open link` button and a `Copy install command` button that shows the exact command.

## Can I trust the suggested links?

The names, descriptions and addresses in the suggestion list are all **text written by other people**. So this plugin shows how far each item can be trusted, and is built not to trust other people's text as it is. **Still, these labels are only a hint and do not guarantee safety.**

**Source tier (shown on every item)**

| Label | Meaning |
| --- | --- |
| Official marketplace | In Claude's official marketplace (`claude-plugins-official`) |
| Reviewed by Anthropic / Reviewed (partner) | The plugin directory record says that review is done |
| A marketplace you added | In a marketplace you added yourself |
| Listed in directory · not reviewed | Listed in the directory but with no review record (most of the 3,700+ entries in the directory on my PC) |
| Unverified source (GitHub search) | Came from a GitHub search. If it is also in the directory, it takes that tier |

- **The owner (GitHub account) is always shown.** Look-alike names really exist. For example the owner of `Figma` is the official `figma`, but a name like "figma-suite" belongs to another individual account. Check that the owner is right first.
- **GitHub results carry caution flags.** Not updated for over a year, less than 30 days old, no license, a fork of another repository, very few forks for its star count (star counts can be faked). Results are ordered by source tier, then fewer caution flags, then star count.

**Other people's text is not trusted as it is**

- A link is not taken from the address in the list. It is built directly as `https://github.com/…` from a verified `owner/repo`. An address that is not `github.com` never becomes a link.
- An install command is built only when the name consists of letters, digits, `.`, `_` and `-`. The real directory has 66 names such as `S&P Global` with special characters that are dangerous to paste into a command as they are. Those are turned into a command based on the repository address, and if that is not safe either, no command is built.
- Before anything is drawn on screen, tricky characters such as line breaks, control characters and characters that flip the text direction are removed.
- Nothing is installed for you. The command is copied, and shown on screen exactly as it is.

These rules live in `hooks/trust.ts` and can be tested on their own, without Claude Code: `node --test test/` (Node 23.6 or newer). If you find a gap, please tell me in Issues.

## How many tokens does it use?

- **The plugin itself adds nothing to the conversation (what the model reads).** The panel screen and the log never go to the model.
- A model is called in only two cases: when translating descriptions into the chosen language (including when English descriptions are shown in Korean), and when turning a Korean search word that is not in the dictionary into an English search word. Both use the lowest tier (haiku), and translations are saved so they are not repeated. A model is not used to scan files.
- **Other plugins you installed use tokens on their own.** The names and one-line descriptions of skills and subagents go to the AI on every turn. By a rough count from character counts (not real token counts), on the author's PC the descriptions of 9 plugins and 15 skills came to about 6,600 tokens per turn, and switching off the 3 biggest saved about 3,700 tokens. Switching off what you don't use is the surest saving.

## Cautions

- **Turning plugins on or off takes effect right away, with no confirmation.** Switching off does not delete files, it only changes a setting, so you can turn it back on any time. It actually takes effect **the next time Claude Code starts**.
- **Removing old cache cannot be undone.** It does not touch the installed version or folders marked as in use, and it asks for confirmation before deleting.
- **"Move to global" is a copy.** The original stays, and deleting the original is a separate confirmation. If you edit the original after copying, the copy is not updated automatically.
- **Suggestions do not guarantee safety.** Before installing, check that the owner is right, and read the repository code and the permissions it asks for.
- **Be careful with `Turn off`.** If you switch off a plugin you are using, that feature is gone from the next start. Press `Turn on` to bring it back.
- Turning on and off, moving, and install-related features use the `claude` command. They may fail where this command is missing (for example if you only use the desktop app). "Detected environment" in the Environment tab shows whether it is available.
- This plugin uses a part of Claude Code's plugin features that is still early. If Claude Code is updated, the behavior may change.

## What does it do on my computer? (written out openly)

**What it reads**: the install records, skill files, settings, the plugin directory cache and the list of known projects in Claude's config folder (`~/.claude`, or wherever `CLAUDE_CONFIG_DIR` points).

**What goes out over the internet**
- GitHub search: **only when you press the button in the Suggestions tab or type `/ai-find`**, one search word such as `video` goes to `api.github.com`. Your conversation and login information are not sent.
- Model calls: only the two cases written in "How many tokens does it use?" above.
- The original text of what you said is neither saved nor sent. Only the detected topic and search words are used.

**What it changes (only when you press a button)**
- Turning plugins on or off: runs `claude plugin enable|disable`.
- Moving a folder-only tool to global: copies after confirmation. Deleting the original is confirmed separately once more.
- Removing old cache: deletes after confirmation.
- The plugin cannot switch itself off.

## Known limitations

- **Only checked on the Claude Code desktop app on Windows.** I have not checked Mac, Linux, the terminal or VS Code. The code has Mac and Linux branches but I have never run them.
- It is for Claude Code only. Tools you use outside Claude Code cannot be detected automatically, so record them by hand with `/ai-log` if you need to.
- **Suggestions depend on the plugin directory file stored on your PC (`plugin-directory-cache-v2.json`).** If the file is missing or renamed, it searches only the marketplaces you added. GitHub search works either way.
- Suggestions recognize topics with a word dictionary. A topic that is not in the dictionary can be missed (then use `/ai-find what you want`), and a high star count does not mean a good tool.
- **The source tier and caution flags are decided only from values in the directory record and the GitHub response.** It does not read the repository code to check that it is safe. A correct owner name does not mean the code is safe.
- GitHub search is used without logging in, so it is limited to 10 searches per minute.
- Translation quality depends on the model. If you find an awkward translation, please tell me.

## When something goes wrong

| Symptom | What to try |
| --- | --- |
| I can't see the panel | Type `/ai-tools`. If that doesn't work, quit Claude Code completely and start it again. |
| The panel only says "Nothing to show yet" | It means the panel hit an error while drawing. Type `/ai-tools` again, and if it keeps happening, paste the error line shown in the chat (`ai-tool-tracker: … hook skipped`) into Issues. |
| Descriptions show in English | A translation may still be in progress. If it is still the same after a few minutes, check "Translation" in the Environment tab and tell me. |
| No suggestions appear | The topic may not be in the dictionary. Search directly with `/ai-find what you want`. |
| GitHub search fails with "rate limit" | Searches without login are limited to 10 per minute. Try again after a minute. |
| Turning on/off or moving fails | In the Environment tab, check "Detected environment" to see whether the `claude` command is available. |
| Something is off on Mac or Linux | I have not been able to check those. Please tell me in Issues together with your environment details. |

## If you don't know the terms

- **Plugin**: a bundle that adds features to Claude Code. It can hold skills, agents, MCP servers and hooks.
- **Skill**: a written guide for how to do a particular task. It is read and followed only when it is called, or when Claude decides it is needed. While unused, only its name and one-line description are loaded.
- **MCP server**: a tool that connects to an outside service (Notion, Figma and so on).
- **Hook**: code that runs automatically when something happens. It keeps running while it is on, so switching it off has the biggest effect.

## Disclaimer

This is an independent project. It is not affiliated with or endorsed by Anthropic. Suggestions are a convenience, not a recommendation or a guarantee, and the author takes no responsibility for what you install. The software is provided as is, under the MIT license.

## Contributing

Bug reports, ideas and small, focused pull requests are welcome. Before you open a pull request, run the checks:

```
node --test test/
claude plugin validate .
```

- **Bugs and ideas**: post them in [Issues](https://github.com/newpy15/ai-tool-tracker/issues). Forms are ready. For a bug, pasting the "Detected environment" text from the panel's **Environment** tab makes the cause easier to find (please hide any path that contains your user name). For an idea, an example such as "when I say this, I'd like this tool to be suggested" helps even more.
- **Security**: if you find a way to make the plugin build an unsafe link or command, please open an Issue titled `[Security]` without the exploit details and I will follow up.
- **Rules**: anything that handles text written by other people belongs in `hooks/trust.ts` with a test in `test/trust.test.mjs`.

## License

[MIT](LICENSE)
