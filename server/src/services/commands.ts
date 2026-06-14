import { pool } from "../db/pool.js";
import type { DeviceCommand } from "../types.js";

export interface DeviceCommandMessage {
  type: "command";
  command: DeviceCommand;
  connection_secret: string;
  pin?: string;
}

export interface CommandDeliveryOptions {
  pin?: string;
}

function buildCommandMessage(
  command: DeviceCommand,
  connectionSecret: string,
  options?: CommandDeliveryOptions
): DeviceCommandMessage {
  const message: DeviceCommandMessage = {
    type: "command",
    command,
    connection_secret: connectionSecret,
  };

  if (options?.pin && command === "REMOTE_UNLOCK") {
    message.pin = options.pin;
  }

  return message;
}

export async function queueCommand(
  uid: string,
  command: DeviceCommand,
  connectionSecret: string,
  options?: CommandDeliveryOptions
): Promise<void> {
  const payload =
    options?.pin && command === "REMOTE_UNLOCK"
      ? JSON.stringify({ pin: options.pin })
      : null;

  await pool.query(
    `INSERT INTO pending_commands (uid, command, connection_secret, command_payload)
     VALUES ($1, $2, $3, $4)`,
    [uid, command, connectionSecret, payload]
  );
  console.log(`Command queued: uid=${uid} command=${command}`);
}

export async function drainCommands(uid: string): Promise<DeviceCommandMessage[]> {
  const result = await pool.query<{
    command: DeviceCommand;
    connection_secret: string;
    command_payload: { pin?: string } | null;
  }>(
    `DELETE FROM pending_commands
     WHERE uid = $1
     RETURNING command, connection_secret, command_payload`,
    [uid]
  );

  if (result.rows.length > 0) {
    console.log(
      `Commands delivered: uid=${uid} count=${result.rows.length} commands=${result.rows.map((r) => r.command).join(",")}`
    );
  }

  return result.rows.map((row) =>
    buildCommandMessage(row.command, row.connection_secret, {
      pin: row.command_payload?.pin,
    })
  );
}

export function formatCommandForDevice(
  command: DeviceCommand,
  connectionSecret: string,
  options?: CommandDeliveryOptions
): DeviceCommandMessage {
  return buildCommandMessage(command, connectionSecret, options);
}
