# Fortnite Festival RPC

Fortnite Festival RPC is a tool that provides a rich presence integration for Fortnite Festival on Discord.

## Installing

Fortnite Festival RPC requires the Discord desktop app.

To set up Fortnite Festival RPC, follow these steps:
- Install the executable file from the Releases tab in GitHub.
- Run it and keep it open in the background while playing Fortnite Festival.

## Building

If you'd prefer to download and run the code directly, you can do so by following these steps:

- Install Bun from [the Bun website](https://bun.sh/docs/installation) (on Windows: run `powershell -c "irm bun.sh/install.ps1 | iex"`).

- Download the code through whatever means you prefer (eg. GitHub Desktop, Git CLI, or downloading the repository as a .zip)

- Install the necessary dependencies using `bun install`

- Then run `bun run start` to run Fortnite Festival RPC, or use `bun run compile` to build the executable into the project directory, which you can then run directly.

Your configuration is stored in `%APPDATA%\fortnite-festival-rpc\config.json`, so the executable can be moved anywhere on your system.

## Special Thanks

Fortnite Festival RPC is derived from [BetterFortniteRPC](github.com/mmccall0813/BetterFortniteRPC).