/**
 * Passed directly to Node by Codex's PreToolUse hook. Keeping the policy in
 * argv prevents an agent from rewriting it through the writable run directory.
 * The filesystem sandbox remains the boundary if Codex cannot run a hook.
 */
export const CODEX_HOOK_SCRIPT = String.raw`
const fs = require("node:fs");
try {
  const policy = JSON.parse(process.argv[1]);
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  let reason;
  let updatedInput;
  if (event.hook_event_name !== "PreToolUse") {
    reason = "Unexpected hook event";
  } else if (event.tool_name === "Bash") {
    if (policy.shell === "none") {
      reason = "Shell access is disabled";
    } else {
      const command = event.tool_input && event.tool_input.command;
      // Accept words, quoted arguments, pipes and && only. Reject expansions,
      // redirections, background jobs, newlines and nested shell programs.
      const tokens = [];
      let word = "", quote = "", started = false;
      if (typeof command !== "string" || !command.trim()) throw new Error("Missing command");
      for (let i = 0; i < command.length; i++) {
        const c = command[i];
        if (/[\r\n\0]/.test(c)) throw new Error("Multiline command");
        if (quote) {
          if (c === quote) quote = "";
          else {
            if (quote === '"' && /[$\x60\\]/.test(c)) throw new Error("Shell expansion");
            word += c;
          }
        } else if (c === "'" || c === '"') {
          quote = c;
          started = true;
        } else if (/\s/.test(c)) {
          if (started) tokens.push({ word });
          word = "";
          started = false;
        } else if (c === "|" || (c === "&" && command[i + 1] === "&")) {
          if (started) tokens.push({ word });
          tokens.push({ separator: c === "|" ? "|" : "&&" });
          word = "";
          started = false;
          if (c === "&") i++;
        } else {
          if (/[$\x60\\;<>()[\]{}&~*?]/.test(c)) throw new Error("Shell syntax");
          word += c;
          started = true;
        }
      }
      if (quote) throw new Error("Unclosed quote");
      if (started) tokens.push({ word });
      const commands = [[]];
      const separators = [];
      for (const token of tokens) {
        if (token.separator) {
          separators.push(token.separator);
          commands.push([]);
        }
        else commands[commands.length - 1].push(token.word);
      }
      for (const words of commands) {
        const [bin, ...args] = words;
        if (bin === "git") {
          const unsafe = ["--ext-diff", "--textconv", "--filters", "--output", "--exec-path", "--config-env"];
          // Git accepts abbreviated long options, including --ext and --out.
          if (!policy.git.includes(args[0]) || args.some(arg => {
            const option = arg.split("=")[0];
            return option.startsWith("--") && option.length > 2 && unsafe.some(flag => flag.startsWith(option));
          })) {
            reason = "Only read-only git subcommands are allowed";
          }
        } else if (!policy.utilities.includes(bin)) {
          reason = "Command is outside Saaga's shell allowance";
        } else if (bin === "rg" && args.some(arg => /^--(?:pre|hostname-bin)(=|$)/.test(arg))) {
          reason = "Ripgrep executable callbacks are disabled";
        }
      }
      if (!reason) {
        // Read-only Git commands can invoke repository-configured programs.
        // Empty verifier paths also prevent explicit signature flags and %G
        // formats from executing callbacks after log.showSignature is disabled.
        const quoteArg = value => "'" + value.replace(/'/g, "'\\''") + "'";
        const safeCommands = commands.map(words => {
          if (words[0] === "git") {
            const sub = words[1];
            const flags = ["log", "show", "diff"].includes(sub)
              ? ["--no-ext-diff", "--no-textconv"]
              : sub === "blame" ? ["--no-textconv"] : [];
            words = ["git", "--no-pager", "--no-optional-locks",
              "-c", "core.fsmonitor=false", "-c", "core.pager=cat", "-c", "diff.external=",
              "-c", "log.showSignature=false", "-c", "gpg.program=",
              "-c", "gpg.openpgp.program=", "-c", "gpg.x509.program=", "-c", "gpg.ssh.program=",
              sub, ...flags, ...words.slice(2)];
          }
          return words.map(quoteArg).join(" ");
        });
        updatedInput = { ...event.tool_input, command: safeCommands.reduce((out, cmd, i) =>
          out + (i ? " " + separators[i - 1] + " " : "") + cmd, "") };
      }
    }
  } else if (!["apply_patch", "update_plan"].includes(event.tool_name)) {
    reason = "Tool is outside Saaga's tool allowance";
  }
  if (reason) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "deny",
      permissionDecisionReason: "Saaga policy: " + reason
    }}));
  } else if (updatedInput) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: {
      hookEventName: "PreToolUse", permissionDecision: "allow", updatedInput
    }}));
  }
} catch {
  process.stderr.write("Saaga policy: unsupported or malformed tool call\n");
  process.exitCode = 2;
}
`;
