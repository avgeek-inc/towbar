"use client";

import { HugeiconsIcon } from "@hugeicons/react";
import { Key01Icon } from "@hugeicons/core-free-icons";
import { useState } from "react";
import type { AzureCredentialMetadata } from "@workspace/towbar-web-client";
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

export function AzureIntegration() {
  const [editorOpen, setEditorOpen] = useState(false);
  const endpoint = "/v1/core/azure";
  const query = useApiQuery<{
    canManage: boolean;
    credential: AzureCredentialMetadata | null;
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
            title="Azure credentials"
            variant="card"
          >
            <Attributes.Item label="Tenant ID">
              <TypographyCode>{credential.tenantId}</TypographyCode>
            </Attributes.Item>
            <Attributes.Item label="Client ID">
              <TypographyCode>{credential.clientId}</TypographyCode>
            </Attributes.Item>
            <Attributes.Item label="Client secret">
              <TypographyCode>
                ••••{credential.clientSecretSuffix}
              </TypographyCode>
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
                      "Azure Blob Storage backups and restores across Towbar will pause until replacement credentials are stored.",
                    title: "Delete the Azure integration credentials?",
                  }}
                  pendingLabel="Deleting…"
                  success="Azure backup credentials deleted"
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
            <EmptyState.Title>Azure is not configured</EmptyState.Title>
            <EmptyState.Description>
              {canManage
                ? "Add an Azure service principal for Azure Blob Storage backups and restores across Towbar."
                : "An administrator can configure the workspace Azure integration."}
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
                    Values are encrypted before storage, scoped to this
                    workspace, and never returned in normal responses. Provide
                    an Azure service principal with Storage Blob Data Contributor
                    role.
                  </p>
                  <SimpleForm
                    fields={[
                      {
                        autoComplete: "off",
                        label: "Tenant ID",
                        maxLength: 64,
                        minLength: 8,
                        name: "tenantId",
                        placeholder: "00000000-0000-0000-0000-000000000000",
                        required: true,
                        type: "text",
                        variant: "secondary",
                      },
                      {
                        autoComplete: "off",
                        label: "Client ID",
                        maxLength: 64,
                        minLength: 8,
                        name: "clientId",
                        placeholder: "00000000-0000-0000-0000-000000000000",
                        required: true,
                        type: "text",
                        variant: "secondary",
                      },
                      {
                        autoComplete: "off",
                        label: "Client secret",
                        maxLength: 256,
                        minLength: 10,
                        name: "clientSecret",
                        required: true,
                        type: "password",
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
                        ? "Azure credentials verified and updated"
                        : "Azure credentials verified and saved"
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
