QUERY_PARAMS = """
    query getPipeline($workspaceSlug:String!, $pipelineCode:String!){
        pipelineByCode(workspaceSlug: $workspaceSlug, code: $pipelineCode) {
            currentVersion {
                versionName
                versionNumber
                parameters {
                    code
                    name
                    type
                    help
                    default
                    required
                    multiple
                    choices
                }
                files {
                    name
                    content
                }
            }
        }
    }
"""
PIPELINE_SOURCE_FILE = "pipeline.py"
PIPELINE_DECORATOR_PATTERN = r"""@pipeline\(\s*["']([^"']+)["']"""
PARAMETER_TYPE_MAP = {
    "dhis2": "DHIS2Connection",
    "custom": "CustomConnection",
    "iaso": "IASOConnection",
    "postgresql": "PostgreSQLConnection",
    "gcs": "GCSConnection",
    "s3": "S3Connection",
    "file": "File",
}
WEBAPP_MAP_PATH = "pipeline_map.json"
# Slug of the orchestrator webapp whose deployed pipeline_map.json is the
# curation authority. The orchestrator uses this same slug in every workspace;
# if a workspace's orchestrator has a different slug, change it here and redeploy.
WEBAPP_SLUG = "snt-pipelines-orchestrator-cockpit"
QUERY_WEBAPP_FILE = """
    query readWebappFile($workspaceSlug: String!, $webappSlug: String!, $path: String!) {
        readWebappFile(workspaceSlug: $workspaceSlug, webappSlug: $webappSlug, path: $path) {
            content
            errors
        }
    }
"""
NOTES = "Catalog for the {workspace_slug} workspace. All of the IDs are workspace-specific."
PARAMETERS_SOURCE = "openhexa_deployed"
EXPECTED_NUM_PIPELINES = 18
PIPELINES_PER_PAGE = 50
# Bucket path, NOT a repo path: do not change it with the repo layout. OUTPUT_DIR +
# "/" + WEBAPP_CARDS_PATH must equal CARDS_OBJECT_KEY in webapps/orchestrator/app.js.
OUTPUT_DIR = "utils_pipelines/create_pipeline_cards/pipeline_cards"
WEBAPP_CARDS_PATH = "pipeline_cards.json"
