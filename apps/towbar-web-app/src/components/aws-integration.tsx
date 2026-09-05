"use client";

import { HugeiconsIcon } from "@hugeicons/react";

import { Key01Icon } from "@hugeicons/core-free-icons";

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
import { refreshApiQueries, useApiQuery } from "@/hooks/use-api-query";
import { api } from "@/lib/api";
import { formatDate } from "./dashboard-overview";

export function AwsIntegration() {
  const [editorOpen, setEditorOpen] = useState(false);
  const endpoint = "/v1/core/aws";
  const query = useApiQuery<{
    canManage: boolean;
    credential: AwsCredentialMetadata | null;
  }>(endpoint);
  if (query.error) return <QueryError message={query.error} />;
  if (!query.data) return <QueryLoading />;
  const credential = query.data.credential;
  const canManage = query.data.canManage;

  return (
    <div className="content-grid">
      {credential ? (
        <div className="content-grid">
          <Attributes
            icon={<HugeiconsIcon icon={Key01Icon} />}
            title="AWS credentials"
            variant="card"
          >
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
                      "S3 backups and restores across Towbar will pause until replacement credentials are stored.",
                    title: "Delete the AWS integration credentials?",
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
            <EmptyState.Title>AWS is not configured</EmptyState.Title>
            <EmptyState.Description>
              {canManage
                ? "Add one AWS credential for S3 backups and restores across Towbar."
                : "An administrator can configure the workspace AWS integration."}
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
                <Modal.Body className="content-grid">
                  <p className="text-muted typography--body-sm">
                    Values are encrypted before PostgreSQL, scoped to this
                    workspace, and never returned.
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
                      refreshApiQueries();
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
