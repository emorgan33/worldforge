# This skill uses the REA MCP server to help reverse engineer the current codebase.

def run(runner):
    runner.intro("🔄 Reverse-engineer-everything skill activated. I'll use the REA MCP tools to understand the code.")
    runner.send(
        "Please list the available REA tools, then start reverse engineering the project.",
        role="user"
    )
