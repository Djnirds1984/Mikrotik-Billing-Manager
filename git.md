It sounds like you're using a single-board computer, like a Raspberry Pi (or similar), for the first time with GitHub, which often requires extra setup because it's a "fresh" machine.

Since you're connecting to a **private repository** and need a passwordless connection, the only secure way is to set up a new **SSH key** specific to your board and add it to your GitHub account.

Here are the complete instructions for setting up the SSH connection on your new board.

## 🔑 Step 1: Generate a New SSH Key Pair

You need to create a unique key pair on your new board. I recommend the highly secure Ed25519 algorithm.

1.  Open the terminal on your board.
2.  Run the following command, replacing the email with the one linked to your GitHub account (`aldrincabanez9@gmail.com`):
    ```bash
    ssh-keygen -t ed25519 -C "aldrincabanez9@gmail.com"
    ```
3.  When prompted for a file name, press **Enter** to accept the default location (`/root/.ssh/id_ed25519`).
4.  When prompted for a **passphrase**, you can enter a strong phrase for security or press **Enter twice** to leave it blank for a completely passwordless experience.

-----

## 📋 Step 2: Copy the Public Key

The public key needs to be copied so you can paste it into GitHub.

1.  View and copy the contents of the public key file (`id_ed25519.pub`):
    ```bash
    cat ~/.ssh/id_ed25519.pub
    ```
2.  The output will be a single long line starting with `ssh-ed25519 ...`. **Copy this entire line.** If you are using SSH to connect to your board, you can paste the output directly into a local text editor to copy it.

-----

## 🌐 Step 3: Add the Public Key to GitHub

This associates your board's key with your GitHub account.

1.  On a separate computer or browser, log in to **GitHub** as **Djnirds1984**.
2.  Go to **Settings** (click your profile picture).
3.  In the left sidebar, click **SSH and GPG keys**.
4.  Click **New SSH key**.
5.  **Title:** Give it a clear name (e.g., "**Raspberry Pi Billing Manager**").
6.  **Key:** Paste the entire public key line you copied in Step 2.
7.  Click **Add SSH key**.

-----

## ✅ Step 4: Test and Clone the Repository

Back on your board, run these commands to verify the setup and then clone your repository using the SSH URL.

1.  **Test the connection:** (If you used a passphrase, you may be prompted for it now.)

    ```bash
    ssh -T git@github.com
    ```

    You should see: `Hi Djnirds1984! You've successfully authenticated...`

2.  **Clone the repository using SSH:** This URL is the permanent passwordless link.

    ```bash
    git clone git@github.com:Djnirds1984/Mikrotik-Billing-Manager.git
    ```

From now on, any `git pull` or `git push` command on this repository, from this board, will use the SSH key and not ask for a password.
