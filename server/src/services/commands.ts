import { pool } from "../db/pool.js";
import type { DeviceCommand } from "../types.js";

export interface DeviceCommandMessage {
  type: "command";
  command: DeviceCommand;
  pin?: string;
  iceServers?: Array<{ urls: string; username?: string; credential?: string }>;
}

export interface CommandDeliveryOptions {
  pin?: string;
  iceServers?: Array<{ urls: string; username?: string; credential?: string }>;
}

function buildCommandMessage(
  command: DeviceCommand,
  options?: CommandDeliveryOptions
): DeviceCommandMessage {
  const message: DeviceCommandMessage = {
    type: "command",
    command,
  };

  if (options?.pin && command === "REMOTE_UNLOCK") {
    message.pin = options.pin;
  }

  if (options?.iceServers && command === "START_REMOTE_ADMIN") {
    message.iceServers = options.iceServers;
  }

  return message;
}

export async function queueCommand(
  uid: string,
  command: DeviceCommand,
  options?: CommandDeliveryOptions
): Promise<void> {
  let payloadObj: Record<string, unknown> | null = null;
  if (options?.pin && command === "REMOTE_UNLOCK") {
    payloadObj = { pin: options.pin };
  } else if (options?.iceServers && command === "START_REMOTE_ADMIN") {
    payloadObj = { iceServers: options.iceServers };
  }
  const payload = payloadObj ? JSON.stringify(payloadObj) : null;

  await pool.query(
    `INSERT INTO pending_commands (uid, command, command_payload)
     VALUES ($1, $2, $3)`,
    [uid, command, payload]
  );
  console.log(`Command queued: uid=${uid} command=${command}`);
}

export async function drainCommands(uid: string): Promise<DeviceCommandMessage[]> {
  const result = await pool.query<{
    command: DeviceCommand;
    command_payload: { pin?: string; iceServers?: Array<{ urls: string; username?: string; credential?: string }> } | null;
  }>(
    `DELETE FROM pending_commands
     WHERE uid = $1
     RETURNING command, command_payload`,
    [uid]
  );

  if (result.rows.length > 0) {
    console.log(
      `Commands delivered: uid=${uid} count=${result.rows.length} commands=${result.rows.map((r) => r.command).join(",")}`
    );
  }

  return result.rows.map((row) =>
    buildCommandMessage(row.command, {
      pin: row.command_payload?.pin,
      iceServers: row.command_payload?.iceServers,
    })
  );
}

export function formatCommandForDevice(
  command: DeviceCommand,
  options?: CommandDeliveryOptions
): DeviceCommandMessage {
  return buildCommandMessage(command, options);
}
