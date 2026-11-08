# PayRekha on ECS/Fargate — single-writer reference module.
# The Helm chart is the primary k8s path; this is the AWS-native equivalent.
# Deliberately single-replica: a second writer CAS-fences itself — run
# desired_count=1 and rely on snapshot restore + task replacement for HA,
# or use the shared-state Postgres backend with the Helm chart.

variable "image" { default = "ghcr.io/peopleofproduct/payrekha:latest" }
variable "vpc_id" { type = string }
variable "private_subnets" { type = list(string) }
variable "payrekha_env" {
  type        = map(string)
  description = "PAYREKHA_* env — keep secrets out: use secrets{} for tokens"
  default     = {}
}
variable "secrets" {
  type        = map(string) # name -> Secrets Manager ARN
  description = "PAYREKHA_API_KEYS/ADMIN_KEY/HASH_KEY/STATE_HMAC_KEY etc as Secrets Manager ARNs"
  default     = {}
}
variable "cpu" { default = 512 }
variable "memory" { default = 1024 }

resource "aws_ecs_cluster" "this" { name = "payrekha" }

resource "aws_security_group" "svc" {
  vpc_id = var.vpc_id
  ingress {
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"] # internal only — put it behind your internal ALB
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_ecs_task_definition" "this" {
  family                   = "payrekha"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  container_definitions = jsonencode([{
    name  = "payrekha"
    image = var.image
    portMappings = [{ containerPort = 8080 }]
    readonlyRootFilesystem = true
    environment = [for k, v in var.payrekha_env : { name = k, value = v }]
    secrets     = [for k, arn in var.secrets : { name = k, valueFrom = arn }]
    healthCheck = {
      command  = ["CMD-SHELL", "curl -sf http://localhost:8080/readyz || exit 1"]
      interval = 15
      retries  = 3
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = { "awslogs-group" = "/ecs/payrekha", "awslogs-region" = data.aws_region.current.name, "awslogs-stream-prefix" = "payrekha" }
    }
  }])
  ephemeral_storage { size_in_gib = 21 } # state file + decision log
}

resource "aws_ecs_service" "this" {
  name            = "payrekha"
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  desired_count   = 1 # single writer — see header
  launch_type     = "FARGATE"
  deployment_circuit_breaker { enable = true; rollback = true }
  network_configuration {
    subnets          = var.private_subnets
    security_groups  = [aws_security_group.svc.id]
    assign_public_ip = false
  }
}

data "aws_region" "current" {}
output "service_name" { value = aws_ecs_service.this.name }
