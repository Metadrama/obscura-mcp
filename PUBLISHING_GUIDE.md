# NPM Publishing Guide for mcp-obscura

This guide will walk you through publishing the `mcp-obscura` package to the npm registry. It is written specifically for beginners, so don't worry if you haven't published an npm package before!

## Step 1: Create an npm account
If you haven't already, you need an account on npm.
1. Go to [npmjs.com](https://www.npmjs.com/) and click **Sign Up**.
2. Fill out your details and verify your email address. You cannot publish packages without verifying your email.

## Step 2: Log in via your terminal
Open your terminal (command prompt), navigate to the `mcp-obscura` project folder, and run:
```bash
npm login
```
It will prompt you to open a browser window to authenticate. Follow the on-screen instructions to complete the login process. You only need to do this once per computer.

## Step 3: Test your package one last time (Optional but recommended)
Before publishing, it's a good idea to verify everything works:
```bash
npm install
node test-mcp.js
node test-browse.js
```
If the tests pass without errors, you are good to go!

## Step 4: Publish!
Once logged in and tested, ensure you are in the root directory of the project (where `package.json` is located). Then simply run:
```bash
npm publish
```

### Note on package naming:
The package name inside `package.json` is currently `mcp-obscura`. If another user has already taken this name on npm, you will get an error like `E403 You do not have permission to publish "mcp-obscura"`.

If this happens, you have two options:
1. **Change the name:** Open `package.json`, change `"name": "mcp-obscura"` to something unique like `"mcp-obscura-yourname"`, and run `npm publish` again.
2. **Publish as a scoped package:** Change the name in `package.json` to `"@your-npm-username/mcp-obscura"`. Then publish it using:
   ```bash
   npm publish --access public
   ```

## Step 5: Verify
Once published, you should be able to see your package live at:
`https://www.npmjs.com/package/mcp-obscura` (or whatever name you chose).

People can now install your package globally by running:
```bash
npm install -g mcp-obscura
```

Congratulations! 🎉
