"use client";

import { useState } from "react";
import type { AwsCredentialMetadata } from "@workspace/towbar-web-client";
import { QueryError, QueryLoading } from "@workspace/towbar-web-ui/query-state";
import { StatusBadge } from "@workspace/towbar-web-ui/status-badge";
import { Button } from "@workspace/web-design-system/buttons/button";
import { Attributes } from "@workspace/web-design-system/data-display/attributes";
import { EmptyState } from "@workspace/web-design-system/data-display/empty-state";
import { Modal } from "@workspace/web-design-system/overlays/modal";
import { TypographyCode } from "@workspace/web-design-system/typography/typography";

import { ActionButton, SimpleForm } from "@/components/page-parts";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export function SourceAwsCredentials({
  canManage,
  query,
  sourceId,
}: {
  canManage: boolean;
  query: {
    data?: { credential: AwsCredentialMetadata | null };
    error?: string;
    refresh: () => void;
  };
  sourceId: string;
}) {
  const [editorOpen, setEditorOpen] = useState(false);
  const endpoint = `/v1/core/sources/${sourceId}/aws`;
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const credential = query.data.credential;

  return (
    <div className="grid gap-10">
      {credential ? (
        <div className="grid gap-5">
          <Attributes title="S3 backup credentials" variant="card">
            <Attributes.Item label="Access key">
              <TypographyCode>
                ••••{credential.accessKeyIdSuffix}
              </TypographyCode>
            </Attributes.Item>
            <Attributes.Item label="Region">
              {credential.region}
            </Attributes.Item>
            <Attributes.Item label="Status">
              <StatusBadge status={credential.status} />
            </Attributes.Item>
            <Attributes.Item label="Last verified">
              {credential.lastVerifiedAt
                ? formatDate(credential.lastVerifiedAt)
                : "Never"}
            </Attributes.Item>
          </Attributes>
          {canManage ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-3">
                <Button onPress={() => setEditorOpen(true)}>
                  Update credentials
                </Button>
              </div>
              <div>
                <ActionButton
                  action={() => api.delete(endpoint)}
                  confirm={{
                    actionLabel: "Delete credentials",
                    description:
                      "S3 backups and restores from this Source will be unavailable until replacement credentials are stored.",
                    title: "Delete this Source's S3 backup credentials?",
                  }}
                  pendingLabel="Deleting…"
                  success="S3 backup credentials deleted"
                  variant="danger"
                >
                  Delete credentials
                </ActionButton>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {!credential ? (
        <EmptyState>
          <EmptyState.Header>
            <EmptyState.Title>No S3 backup credentials</EmptyState.Title>
            <EmptyState.Description>
              {canManage
                ? "Add Source-scoped AWS credentials only if you use S3 backups or restores."
                : "An administrator can add this Source's S3 backup credentials."}
            </EmptyState.Description>
          </EmptyState.Header>
          {canManage ? (
            <EmptyState.Content>
              <Button onPress={() => setEditorOpen(true)}>
                Add credentials
              </Button>
            </EmptyState.Content>
          ) : null}
        </EmptyState>
      ) : null}
      {canManage ? (
        <Modal isOpen={editorOpen} onOpenChange={setEditorOpen}>
          <Modal.Backdrop>
            <Modal.Container scroll="inside" size="sm">
              <Modal.Dialog>
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>
                    {credential ? "Update credentials" : "Add credentials"}
                  </Modal.Heading>
                </Modal.Header>
                <Modal.Body className="space-y-6">
                  <p className="text-muted typography--body-sm">
                    Values are encrypted before PostgreSQL, scoped to this
                    Source, and never returned.
                  </p>
                  <SimpleForm
                    fields={[
                      {
                        autoComplete: "off",
                        label: "Access key ID",
                        maxLength: 128,
                        minLength: 16,
                        name: "accessKeyId",
                        required: true,
                        variant: "secondary",
                      },
                      {
                        autoComplete: "new-password",
                        label: "Secret access key",
                        maxLength: 256,
                        minLength: 20,
                        name: "secretAccessKey",
                        required: true,
                        type: "password",
                        variant: "secondary",
                      },
                      {
                        defaultValue: credential?.region,
                        label: "Default AWS region",
                        maxLength: 64,
                        name: "region",
                        placeholder: "ap-south-1",
                        required: true,
                        variant: "secondary",
                      },
                    ]}
                    onSubmit={async (values) => {
                      await api.put(endpoint, values);
                      query.refresh();
                      setEditorOpen(false);
                    }}
                    successMessage={
                      credential
                        ? "S3 backup credentials verified and updated"
                        : "S3 backup credentials verified and saved"
                    }
                    submitLabel="Save credentials"
                  />
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      ) : null}
    </div>
  );
}
