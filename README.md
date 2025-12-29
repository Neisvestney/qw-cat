<p align="center">
    <img width="150" height="150" src="src/assets/qwcat_big.svg" alt="Logo">
    <h1 align="center"><b>Qw Cat</b></h1>
    <p  align="center">
        Desktop application designed for quick video trimming and processing.
    </p>
    <p align="center">
        <a href="https://github.com/Neisvestney/qw-cat/releases/latest">
            <img alt="Windows download" src="https://img.shields.io/badge/download-windows_x64-blue?style=for-the-badge">
        </a>
        <a href="https://github.com/Neisvestney/qw-cat/releases/latest">
            <img alt="Linux download" src="https://img.shields.io/badge/download-linux_x64_.deb-orange?style=for-the-badge&logo=debian">
        </a>
        <a href="https://github.com/Neisvestney/qw-cat/releases/latest">
            <img alt="Linux download" src="https://img.shields.io/badge/download-linux_x64_.rpm-blue?style=for-the-badge&logo=fedora">
        </a>
        <a href="https://github.com/Neisvestney/qw-cat/releases/latest">
            <img alt="Other download" src="https://img.shields.io/badge/download-other-lightslategray?style=for-the-badge">
        </a>
    </p>
</p>
<br/>

## Overview

[![GitHub Release](https://img.shields.io/github/v/release/Neisvestney/qw-cat?display_name=release&style=flat-square&label=Latest%20version)](https://github.com/Neisvestney/qw-cat/releases/latest)

![Screenshot](src/assets/app_demo.png)

Built with Tauri v2 and React, powered by FFmpeg.

## Features

- Mixing multiple audio tracks into one with different volume
- Running FFmpeg with NVIDIA hardware acceleration and using gpu encoders
- Automatic ffmpeg download
- Easy-to-use interface with advanced ffmpeg command customization options

**Note:** Currently, only NVIDIA GPU hardware acceleration is supported. AMD and Intel GPU support is not yet
implemented.

## Installation

- Download the latest release from the [releases page](https://github.com/Neisvestney/qw-cat/releases).
- Run the installer and follow the instructions.
- Launch the application.

You can install FFmpeg before launching the application if you want to use it right away.

For linux you also need to [install](https://gstreamer.freedesktop.org/documentation/installing/on-linux.html?gi-language=c) `gstreamer` with plugins to be able to play videos.  
For KDE Plasma you can install `libunity9` package to display a progress bar in the taskbar.

**Note:** The application has not been tested on macOS yet.

## Development

- Follow the [Tauri documentation](https://v2.tauri.app/start/prerequisites/) to setup development environment.
- Install dependencies with `yarn install`
- Run the app with `yarn tauri dev`

## Building

- Run `yarn tauri build`

## Contributing

Pull requests are welcome.  
Please format your code with `cargo fmt` and `cargo clippy` before submitting a PR
