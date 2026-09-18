# SmartLife

SmartLife is an Expo and React Native application for students. It combines class schedules, notes, personal finance, OCR document scanning, notifications, Google Calendar synchronization, and an AI assistant in one mobile experience.

This repository contains the complete application source, shared Firebase client configuration, security rules, Cloud Functions, Google Cloud Vision/iApp OCR integration, and the User and Admin interfaces.

## Team quick start (Windows CMD)

The app is already connected to the shared `smartlife-budget` backend. Gemini,
iApp OCR, Firestore, Storage, Authentication, and Cloud Functions are already
deployed. A teammate does not need to create a Firebase project or obtain API
keys.

Run this one line in CMD:

```cmd
git clone https://github.com/natgamol/Final-Project.git && cd Final-Project && setup-smartlife.cmd -RunAndroid
```

The setup command automatically:

- installs Node.js LTS with `winget` when Node.js is missing;
- installs application and Cloud Functions dependencies;
- creates `.env.local` from the committed public team configuration;
- creates the local `google-services.json` for `com.smartlife.student`;
- opens Firebase login when needed;
- registers a private App Check debug token for that computer and writes it only to the ignored `.env.local`;
- validates the runtime configuration; and
- builds and opens the Android application when `-RunAndroid` is included.

The Google account used during setup must first be added as a teammate on the
`smartlife-budget` Firebase project. No API key or Firebase field needs to be
copied manually. Server secrets never leave Firebase Secret Manager.

## Update an existing teammate copy

If the repository is already installed and the working tree has no personal
changes, open CMD in `Final-Project` and run:

```cmd
git switch main && git pull origin main && setup-smartlife.cmd
```

Then use `npm start` with an installed Development Build, `npm run
start:tunnel` when the phone is on a different network, or `npm run android`
to rebuild and install the Android Development Build.

## Main features

- Firebase Email/Password and Google authentication
- User and Admin applications with role-based access
- Day, week, month, and year schedule views
- Google Calendar two-way synchronization
- Notes and personal finance tracking
- Cloud Vision OCR for receipts and class schedules
- AI schedule extraction and assistant features
- AI Adaptive Scheduling with deterministic conflict checks, behavior patterns, explainable suggestions, and Undo
- Firebase Storage, Firestore, Cloud Functions, rules, and indexes
- Thailand date and time formatting (`Asia/Bangkok`)

## Technology stack

- Expo SDK 57 and React Native
- TypeScript and Expo Router
- Firebase Authentication, Firestore, Storage, and Cloud Functions
- Google Cloud Vision API
- Google Calendar API and Google OAuth 2.0
- Gemini AI and iApp OCR through Firebase Secret Manager

## Requirements

- Node.js 20 or newer
- npm
- Git
- Android Studio and an Android emulator, or a physical Android device
- Team access to the shared Firebase project for automatic App Check registration

Google Login and voice input use native modules. Test those features with a SmartLife Development Build; they are not available in Expo Go.

## Setup without launching Android

```bash
git clone https://github.com/natgamol/Final-Project.git && cd Final-Project && setup-smartlife.cmd
```

Without `-RunAndroid`, the script prepares and verifies the project, then prints
the next command. Re-running it is safe; the App Check entry for the same
computer is replaced instead of accumulating duplicate team tokens.

`.env.example` and `config/google-services.team.json` contain only public mobile
client identifiers. They are embedded in every installed Firebase application
and are not server secrets. Never commit `.env.local`, App Check debug tokens,
service-account JSON, Gemini/iApp keys, production signing keys, or refresh
tokens.

## Shared Firebase and Google Cloud backend

The shared backend uses Firebase project `smartlife-budget` in
`asia-southeast1` (Singapore). Teammates use the existing services and data
rules; they do not create another Firebase project.

These services are already enabled:

- Firebase Authentication: Email/Password and Google providers
- Cloud Firestore
- Cloud Storage
- Cloud Functions and Secret Manager
- Google Cloud Vision API
- Google Calendar API

Email/password authentication works against the shared project immediately.
Native Google Login additionally requires a development build signed with a
certificate registered for package `com.smartlife.student`; this OAuth
restriction cannot be replaced by a public API key. Ask the maintainer for the
team development build if a new computer's local debug certificate is not yet
registered.

The Gemini and iApp API keys are already stored in Firebase Secret Manager, not
in `.env.local`, GitHub, or the mobile app. Only a backend maintainer should ever
rotate them:

```bash
npx -y firebase-tools@latest functions:secrets:set GEMINI_API_KEY --project smartlife-budget
npx -y firebase-tools@latest functions:secrets:set IAPP_API_KEY --project smartlife-budget
```

Only a project owner or authorized backend teammate needs to set this shared secret.

## Check the local configuration

```bash
npm run doctor
npm run typecheck
npm run lint
```

## Run the application

Start the installed SmartLife Development Build on the same network:

```bash
npm start
```

Start through a tunnel when the phone and computer are on different networks:

```bash
npm run start:tunnel
```

Build and install the native Android development application:

```bash
npm run android
```

Run the web version:

```bash
npm run web
```

Expo Go can be used for limited UI testing with `npm run start:expo-go`, but native Google Login and voice input require the Development Build.

## Firebase deployment

Log in and select the project:

```bash
npx -y firebase-tools@latest login
npx -y firebase-tools@latest use smartlife-budget
```

Deploy the Adaptive Scheduling rules, indexes, and named Cloud Functions without touching the separately maintained LINE functions:

```bash
npm run deploy:adaptive-backend
```

Deploy Storage rules separately only when `storage.rules` changes:

```bash
npx -y firebase-tools@latest deploy --only storage --project smartlife-budget
```

Avoid an unscoped `--only functions` deployment from this source tree. The shared project contains LINE integration functions that are deployed from another source tree, and Firebase CLI may otherwise ask to delete them.

Do not deploy backend changes without coordinating with the team because these resources are shared by every developer.

## Project structure

```text
src/app/                 Expo Router routes
src/screens/             User, Admin, Login, and legacy screens
src/components/          Shared visual and interactive components
src/services/            Firebase, OCR, Google Calendar, and AI services
src/providers/           Authentication and application context
src/types/               Shared TypeScript models
functions/src/           Firebase Cloud Functions and OCR parsers
firestore.rules          Firestore security rules
firestore.indexes.json   Firestore indexes
storage.rules            Cloud Storage security rules
docs/                    Detailed setup and architecture notes
```

## Team workflow

Create a separate branch for each task:

```bash
git switch main
git pull origin main
git switch -c feature/short-description
```

After completing and checking the work:

```bash
git add <changed-files>
git commit -m "feat: describe the completed work"
git push -u origin feature/short-description
```

Open a Pull Request into `main`. Avoid committing directly to `main`, and do not share passwords, API secrets, private keys, or personal `.env.local` files in GitHub issues or chat.

## Additional documentation

- [คู่มือติดตั้งสำหรับเพื่อนแบบคำสั่งเดียว](docs/TEAM_INSTALL_TH.md)
- [Firebase setup](docs/FIREBASE_SETUP.md)
- [Google Calendar setup](docs/google-calendar-setup.md)
- [Screen map](docs/SCREEN_MAP.md)
- [AI Adaptive Scheduling architecture, schema, tests, and deployment](docs/ADAPTIVE_SCHEDULING.md)

## Repository

<https://github.com/natgamol/Final-Project>
