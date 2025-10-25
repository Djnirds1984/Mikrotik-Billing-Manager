# Mikrotik Billling Management by AJC - Git & Development Guide

This guide is for developers who want to contribute to the project or set up their own development environment from a fork. For production deployment, please see the `README.md` file.

## Prerequisites

Before you begin, ensure you have the following installed on your development machine:

-   **Git:** For version control.
-   **Node.js:** Version 20.x or newer.
-   **A GitHub Account:** To fork and manage your version of the repository.
-   **A Code Editor:** Such as Visual Studio Code.

## 1. Fork & Clone the Repository

To contribute without affecting the main project directly, you should work on a fork.

1.  **Fork the Repository:**
    Go to the main project repository on GitHub (`https://github.com/Djnirds1984/Mikrotik-Billing-Manager`) and click the "Fork" button in the top-right corner. This creates a copy of the repository under your own GitHub account.

2.  **Clone Your Fork:**
    On your local machine, run the following command, replacing `<your-username>` with your GitHub username:
    ```bash
    git clone https://github.com/<your-username>/Mikrotik-Billing-Manager.git
    ```

3.  **Navigate into the Directory:**
    ```bash
    cd Mikrotik-Billing-Manager
    ```

4.  **Add the `upstream` Remote:**
    This allows you to pull in changes from the original project to keep your fork up-to-date.
    ```bash
    git remote add upstream https://github.com/Djnirds1984/Mikrotik-Billing-Manager.git
    ```

5.  **Verify Remotes:**
    Check that your remotes are set up correctly.
    ```bash
    git remote -v
    ```
    You should see an `origin` pointing to your fork and an `upstream` pointing to the original repository.

## 2. Install Dependencies

The project is split into two Node.js applications (`proxy` for the UI and `api-backend` for the MikroTik API). You need to install dependencies for both.

From the project's **root directory**, run:

```bash
# Install dependencies for the UI server
npm install --prefix proxy

# Install dependencies for the API backend server
npm install --prefix api-backend
```

## 3. Configure Environment

The AI features require a Google Gemini API key.

1.  Open the `env.js` file in the root directory.
2.  Replace `"YOUR_GEMINI_API_KEY_HERE"` with your actual API key.
3.  **Do not commit this file.** A `.gitignore` file is included to prevent your key from being exposed.

## 4. Running the Development Servers

For development, you should run each server in a separate terminal.

1.  **Start the UI Server:**
    ```bash
    npm start --prefix proxy
    ```
    This server runs on `http://localhost:3001`.

2.  **Start the API Backend Server:**
    ```bash
    npm start --prefix api-backend
    ```
    This server runs on `http://localhost:3002`.

You can now access the application by opening `http://localhost:3001` in your web browser.

## 5. Development Workflow (Contributing)

Follow these steps to contribute new features or fixes.

1.  **Keep Your `main` Branch Updated:**
    Before starting new work, sync your fork with the original repository.
    ```bash
    # Fetch the latest changes from the upstream remote
    git fetch upstream

    # Check out your main branch
    git checkout main

    # Merge the upstream main branch into your local main branch
    git merge upstream/main
    ```

2.  **Create a Feature Branch:**
    Never work directly on the `main` branch. Create a new branch for your changes.
    ```bash
    git checkout -b feature/my-new-feature
    # Or for a bug fix:
    # git checkout -b fix/issue-with-dashboard
    ```

3.  **Make Your Changes:**
    Write your code, fix bugs, and add new features.

4.  **Commit Your Changes:**
    Add your changed files and commit them with a descriptive message.
    ```bash
    git add .
    git commit -m "feat: Add new dashboard widget for monitoring Thingamajigs"
    ```

5.  **Push to Your Fork:**
    Push your new branch to your `origin` remote (your fork).
    ```bash
    git push origin feature/my-new-feature
    ```

6.  **Create a Pull Request:**
    Go to your forked repository on GitHub. You will see a prompt to create a new **Pull Request** from your recently pushed branch. Click it, add a clear title and description of your changes, and submit it for review.