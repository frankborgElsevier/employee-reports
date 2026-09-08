# Employee Reports

A local, single-user dashboard for importing a permitted WorkDay report and
viewing headcount, employee details, and contractor data. The application runs
only on your computer; it is not a hosted or multi-user service.

## What is not shared

This repository intentionally does not include WorkDay spreadsheets, local
employee data, SQLite databases, temporary uploads, or environment files. No
sample or template workbook is supplied. Import only WorkDay data you are
authorized to access.

The current application does not need a `.env` file to run. If you add an
environment file for your own local use in the future, keep it private.

## Prerequisites

Install Node.js 22 or later and npm. Check that both are available:

```sh
node --version
npm --version
```

If Node.js is missing or the major version is lower than 22, install a supported
version before continuing. If npm is missing, reinstall Node.js using its
official installer or your system's package manager.

## Install

Clone the repository, change into its directory, then install the locked
dependencies:

```sh
git clone <repository-url>
cd <repository-directory>
npm install
```

Replace `<repository-directory>` with the folder created by the clone command,
or with the destination directory you supplied to `git clone`.

`npm install` uses `package-lock.json`, including the local SQLite dependency.
No database, workbook, or environment file is needed for installation.

If dependency installation fails, confirm the Node.js version first, then retry
after removing only the local `node_modules` directory. A native-dependency
error may also require the standard build tools for your operating system.

## Run locally

Start the application:

```sh
npm start
```

The app attempts to open your default browser. If it does not, open
<http://127.0.0.1:3200> yourself. The service listens only on `127.0.0.1`, so
it is accessible only from the same computer.

On first start, the app creates a local empty database and temporary upload
folder under `data/`. These files remain outside Git. Use the Import screen to
select your own authorized WorkDay `.xlsx` export.

If port 3200 is already in use, stop the other process using that port and run
`npm start` again.

## Verify the installation

These optional commands validate the checkout:

```sh
npm test
npm run typecheck
npm run build
```

- `npm test` runs the automated test suite.
- `npm run typecheck` checks TypeScript types without creating build output.
- `npm run build` compiles TypeScript into the local `dist/` directory.
