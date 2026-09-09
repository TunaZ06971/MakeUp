# MakeUp

**Local-first head capture and virtual makeup for Web, iPhone, and Mac.** Capture naturally, experiment with makeup, and save looks you can adjust and compare.

[Quick Start](#quick-start) · [Architecture](docs/ARCHITECTURE.md) · [Capture Guide](docs/CONTINUOUS_CAPTURE.md) · [Privacy & Public Data Policy](docs/PUBLIC_DATA_POLICY.md) · [Contributing](CONTRIBUTING.md)

> **Status: experimental prototype.** The web app can record video and generate and edit a coarse face model. High-fidelity reconstruction of a complete head is still a research goal. The current implementation does not accurately reproduce a person's full hairstyle, ears, or the back of their head, and a five-minute generation time has not been validated.

## Features

- **Natural head-turn capture:** record without signing in, automatically select candidate frames, review clips, and record additional footage. A full 90° turn is not required, and detection failures do not discard recorded video.
- **Local data management:** photos, videos, landmarks, and scan models stay on your device or in your browser. Import and export are explicit actions; face data is not uploaded automatically.
- **Virtual makeup:** choose products, adjust intensity and finish, paint manually, undo and redo changes, and save makeup recipes.
- **3D face studio:** rotate and zoom the model, inspect textures, apply makeup to the existing face surface, and export GLB files.
- **Experimental Apple clients:** SwiftUI apps for iPhone and Mac, with ARKit and raw TrueDepth capture of visible surfaces on supported physical iPhones.
- **Bilingual interface:** Chinese and English in both the web and Apple clients.

| Capability | Web | iPhone | Native Mac |
|---|---|---|---|
| Continuous video and automatic frame selection | Supported | Browser workflow not yet validated on a physical device | Use the web app |
| Coarse face models and virtual makeup | Supported | Supported | Import and viewing supported |
| Raw TrueDepth capture | Not supported | Experimental; compatible physical device required | Import results |
| Accounts, products, and makeup recipes | Firebase | Firebase | Firebase |
| Complete, high-fidelity head reconstruction | Not yet implemented | Not yet implemented | Not yet implemented |

## Quick Start

### Try Web Capture

You need **Node.js 22.12+** and a browser with camera access and MediaRecorder support. Web automation has been tested in Chrome; other browsers still need device testing.

```sh
git clone https://github.com/TunaZ06971/MakeUp.git
cd MakeUp
npm --prefix web ci
npm --prefix web run dev -- --host 127.0.0.1
```

Open **[http://127.0.0.1:5173/capture](http://127.0.0.1:5173/capture)**. No Firebase project, API key, or GPU is required. Initial setup downloads the MediaPipe model and runtime; face detection then loads those files from the same local origin.

Select **Start recording**, pause briefly facing forward, slowly turn toward whichever side feels comfortable, and return to the front. Each clip can be approximately 25 seconds long. You can review, record more, and export your capture. See the [Continuous Capture Guide](docs/CONTINUOUS_CAPTURE.md).

### Use the Product Catalog and Makeup Recipes

You also need **Java 21+**. Install the tools and start the local Firebase emulators from the repository root:

```sh
npm ci
npm run emulators
```

Leave that terminal running, then open another terminal at the repository root to seed the sample products:

```sh
npm run seed
```

With the web development server still running, open the [studio](http://127.0.0.1:5173) and register with a fictional test email address. The default project is `demo-makeup`, which does not connect to a live Firebase project. A normal emulator shutdown saves local accounts and recipes to the Git-ignored `.firebase/` directory.

Sample shades and materials demonstrate the rendering algorithms. They have not been measured against real products or color-calibrated, and the project has no official affiliation with the listed brands.

### Run the Apple Clients

You need macOS, Xcode with Swift 6 support, and [XcodeGen](https://github.com/yonaskolb/XcodeGen). Minimum deployment targets are iOS 17 and macOS 14. The project has been validated with Xcode 26.

```sh
cp apple/project.local.example.yml apple/project.local.yml
# Set your own development team and unique bundle ID in project.local.yml.
xcodegen generate --spec apple/project.local.yml
open apple/MakeUp.xcodeproj
```

Select the `MakeUp` scheme and a physical iPhone, or `My Mac`. The Simulator cannot validate this project's ARKit face-capture workflow. Native sign-in requires correct code signing and Keychain configuration; disabling signing is not a workaround.

On an iPhone, `127.0.0.1` refers to the phone itself. You can start with local 3D capture without signing in or configuring cloud services. See the [Apple Capture Guide](docs/3D_CAPTURE_GUIDE.md) for the full setup.

## Project Structure

```text
web/                    React + TypeScript web client
  src/features/
    head-capture/       Continuous video, frame selection, local capture packages
    face-scan/          Legacy coarse face capture, texture blending, 3D viewer
    render-engine/      WebGL makeup, masks, and brushes
    auth/ catalog/      Accounts and product catalog
    studio/             Studio and makeup recipes
apple/                  SwiftUI clients for iPhone and Mac
  Packages/MakeUpCore/   Shared models, Vision, Metal, and capture core
shared/                 Material presets shared by both clients
scripts/                Product seeding, asset generation, model evaluation, security checks
docs/                   Architecture, capture, testing, privacy, and reconstruction limits
```

MediaPipe handles face localization and frame selection. Three.js/WebGL and SceneKit/Metal handle rendering and makeup. Firebase handles accounts, products, and recipes. These components do not replace the high-fidelity head-reconstruction backend, which has not yet been integrated. See [Architecture](docs/ARCHITECTURE.md) for details.

## Data and Privacy

**This repository publishes software, not personal capture data.** Public files exclude face photos, recordings, depth data, scan packages, personal models, emulator account exports, and service credentials.

| Data | Default storage or behavior |
|---|---|
| New capture videos and candidate frames | IndexedDB in the current browser; exportable as `.makeupcapture` |
| Legacy face scans, photos, and textures | Local browser or Apple storage; exportable as `.makeupscan`, JSON, or GLB |
| Sign-in and makeup recipes | Local Firebase emulators by default; a live service is used only after configuring a real project |
| Credentials and Apple signing configuration | Personal local files, excluded from Git |

A `.makeupcapture` file is a **source-media container**, not a 3D model. It is not automatically interchangeable with the older `.makeupscan` format. Clearing site data deletes captures stored in the browser. Different browsers, and `localhost` versus `127.0.0.1`, use separate storage.

See the [Public Data Policy](docs/PUBLIC_DATA_POLICY.md) for data categories, ignore rules, and pre-publication checks. To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Development and Validation

```sh
npm run check:materials
npm --prefix web run lint
npm --prefix web run build
python3 -m unittest discover -s scripts/security -p 'test_*.py'
python3 -m unittest discover -s scripts/model-eval -p 'test_*.py'
# Stage only files you have reviewed, for example:
git add README.md
npm run check:public
```

CI checks public files, Git file history, common credential patterns, the web build, and regressions that do not require photos of real people. Full browser and rendering tests require private fixtures that you have permission to use; **these photos are not distributed with the repository**. See the [Testing Guide](docs/TESTING.md) for instructions.

## Roadmap

- Integrate a dedicated head-reconstruction model and validate identity likeness, visible ears, and hairstyle against real captures.
- Distinguish observed regions from model-generated completion and measure total latency from capture to browser display.
- Improve editable skin and makeup materials, and calibrate colors against real products.
- Expand real-person validation across devices, lighting, poses, and skin tones.

[Reconstruction Limits and Research Directions](docs/RECONSTRUCTION.md) distinguishes implemented features, experiments, and unvalidated goals. Research scripts default to dry-run mode and do not automatically purchase compute or call paid services.

## License

Original project code is available under the repository's **[MIT License](LICENSE)**. Third-party code, canonical face topology, models, decoders, and SDKs retain their respective licenses. The MIT license does not relicense those components or grant rights to use anyone's likeness or brand assets. See [THIRD_PARTY.md](THIRD_PARTY.md).
