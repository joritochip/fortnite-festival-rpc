# Fortnite Festival RPC

Fortnite Festival RPC is a tool that provides Discord rich presence and Last.fm scrobbling for Fortnite Festival.

## Installing

Fortnite Festival RPC requires the Discord desktop app.

To set up Fortnite Festival RPC, follow these steps:
- Install the executable file from the [latest release](https://github.com/joritochip/fortnite-festival-rpc/releases/latest) on GitHub.
- Run it and keep it open in the background while playing Fortnite Festival.

### Last.fm scrobbling

The first time you run Fortnite Festival RPC, you will be asked to configure Last.fm scrobbling. Follow the prompts to authenticate your account and begin scrobbling.

Notes about Last.fm credentials:
- Your Last.fm API key and secret will be stored locally on your device after setup.
- Your Last.fm username and password are sent once to Last.fm in order to authenticate and are not stored anywhere.

## Building

If you'd prefer to download and run the code directly, you can do so by following these steps:

- Install Bun from [the Bun website](https://bun.sh/docs/installation) (on Windows: run `powershell -c "irm bun.sh/install.ps1 | iex"`).

- Download the code through whatever means you prefer (eg. GitHub Desktop, Git CLI, or downloading the repository as a .zip)

- Install the necessary dependencies using `bun install`

- Then run `bun run start` to run Fortnite Festival RPC, or use `bun run compile` to build the executable into the project directory, which you can then run directly.

Your configuration is stored in `%APPDATA%\fortnite-festival-rpc\config.json`, so the executable can be moved anywhere on your system.

## Special Thanks

Fortnite Festival RPC is derived from [BetterFortniteRPC](https://github.com/mmccall0813/BetterFortniteRPC).