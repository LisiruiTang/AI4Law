"""Private terminal setup for the shared student password and administrator accounts."""

import argparse
from getpass import getpass

import portal


def prompt_password(label):
    first = getpass(f"{label} (12+ characters): ")
    second = getpass("Repeat password: ")
    if first != second:
        raise SystemExit("The two passwords did not match.")
    if len(first) < 12:
        raise SystemExit("Use at least 12 characters.")
    return first


def main():
    parser = argparse.ArgumentParser(description="Manage AI4Law portal credentials")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("student-password", help="Set or rotate the shared student password")
    admin = commands.add_parser("admin", help="Create or reset an administrator account")
    admin.add_argument("username")
    args = parser.parse_args()
    if args.command == "student-password":
        portal.set_student_password(prompt_password("Shared simulator password"))
        print("Shared simulator password saved. Earlier student sessions were revoked.")
    else:
        try:
            action = portal.set_admin_password(args.username, prompt_password("Administrator password"))
        except ValueError as exc:
            raise SystemExit(str(exc)) from exc
        print(f"Administrator account {action}. Earlier sessions for this account were revoked.")


if __name__ == "__main__":
    main()
