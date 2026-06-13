import { pool } from "../db/pool.js";
import type { DeviceCommand } from "../types.js";

export interface DeviceCommandMessage {
  type: "command";
  command: DeviceCommand;
  connection_secret: string;
}

export async function queueCommand(
  uid: string,
  command: DeviceCommand,
  connectionSecret: string
): Promise<void> {
  await pool.query(
    `INSERT INTO pending_commands (uid, command, connection_secret) VALUES ($1, $2, $3)`,
    [uid, command, connectionSecret]
  );
  console.log(`Command queued: uid=${uid} command=${command}`);
}

export async function drainCommands(uid: string): Promise<DeviceCommandMessage[]> {
  const result = await pool.query<{
    command: DeviceCommand;
    connection_secret: string;
  }>(
    `DELETE FROM pending_commands
     WHERE uid = $1
     RETURNING command, connection_secret`,
    [uid]
  );

  if (result.rows.length > 0) {
    console.log(
      `Commands delivered: uid=${uid} count=${result.rows.length} commands=${result.rows.map((r) => r.command).join(",")}`
    );
  }

  return result.rows.map((row) => ({
    type: "command",
    command: row.command,
    connection_secret: row.connection_secret,
  }));
}
