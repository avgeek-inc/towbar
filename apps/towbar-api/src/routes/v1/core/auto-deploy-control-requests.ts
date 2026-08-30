import { z } from "zod";

const maintenanceWindowSchema = z
  .object({
    daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    endMinute: z.number().int().min(0).max(1_439),
    startMinute: z.number().int().min(0).max(1_439),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(120)
      .refine((timezone) => {
        try {
          new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
          return true;
        } catch {
          return false;
        }
      }, "Timezone must be a valid IANA timezone"),
  })
  .strict();

export const sourceAutoDeployControlPatchSchema = z
  .object({
    maintenanceWindow: maintenanceWindowSchema.nullable().optional(),
    paused: z.boolean().optional(),
    pauseReason: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .strict();

export const deployableAutoDeployControlPatchSchema =
  sourceAutoDeployControlPatchSchema
    .extend({
      failureThreshold: z.number().int().min(0).max(20).optional(),
      recoverCircuit: z.boolean().optional(),
      recoveryPolicy: z.enum(["manual", "on_manual_success"]).optional(),
    })
    .strict();

export const manualDeploymentSchema = z
  .object({ bypassAutomaticControl: z.boolean().optional() })
  .strict();
