---
name: rails-architecture-basics
description: Opinionated Rails standard — `ApplicationService` with `Result` objects, read-only class-method Repositories, Query Objects, Form Objects, plus anti-patterns and safety tooling. TRIGGER when writing or refactoring Ruby/Rails domain code (services, repositories, queries, form objects, callbacks, enums, transactions, input validation). DO NOT TRIGGER for non-Ruby code, gem development, RSpec internals, Capistrano tasks, view templates without Ruby logic, asset pipeline configuration, or Rails framework internals.
version: 1.0.0
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Rails Architecture Basics

> Requires Ruby 3.0+ (endless methods, triple-dot argument forwarding).

## Scope

These rules target **new code**. Apply to legacy at your discretion — for example, when touching the surrounding code anyway. Adopting all rules at once in a mature codebase is rarely worth the churn.

## 1. Architecture Rules

- **Use Service Objects** for domain operations. → workflow lives outside the data model; testable in isolation.
- **Use Query Objects** for non-trivial reads. → keeps complex `where/joins` out of models and controllers.
- **Use Form Objects** for input validation. → decouples validation from persistence; supports context-specific rules.
- **Use Repositories** for shared read access. → centralizes scoping and eager loading; one canonical query per use case.

| Concern | AR Model | Form | Service | Repository | Query |
|---------|----------|------|---------|------------|-------|
| Persistence invariants | ✅ | — | — | — | — |
| Input validation | minimal | ✅ | — | — | — |
| Workflow / side effects | — | — | ✅ | — | — |
| DB read | ✅ | — | — | ✅ | ✅ |
| DB write | ✅ | — | (via AR) | — | — |

### Tiebreaker — when in doubt

- **Writes data** → Service Object.
- **Reads data, reused or scoped** → Repository.
- **Reads data, single complex query** → Query Object.
- **Validates user input** → Form Object.

## 2. Coding Rules

- **Don't add new ActiveRecord callbacks.** → side effects become implicit and order-dependent; put them in a Service.
- **Don't put business logic in concerns.** → concerns mix in invisibly; logic loses its owner and becomes hard to test.
- **Use string enums** for new enums. → survive reordering and new values inserted in the middle.
- **Don't call `html_safe`.** → direct XSS vector; use `sanitize`, `tag`, or `content_tag`.
- **Open transactions explicitly** with `ActiveRecord::Base.transaction`. → boundaries visible at the call site, no callback-coupled persistence.

Legacy callbacks and integer enums stay until the surrounding code is touched — no proactive migration.

## 3. Service Objects

A PORO that orchestrates one domain operation end-to-end (validate → persist → notify).

- **Use when**: operation spans multiple models, has side effects, opens a transaction, or has more than ~5 lines of logic in the controller.
- **Don't use when**: a single `Model.create(params)` would do.
- **Boundary**: knows controllers/jobs above and repositories/forms below — never the other way around.
- **Naming**: `<Context>::<Verb>` (e.g. `Users::Create`).
- **Convention**: inherit from `ApplicationService` (shown below), expose a single `#call`, return a `Result`. Never raise for expected failures, never return raw AR models.

### `ApplicationService` base class

Place in `app/services/application_service.rb`. If the name is already taken in the host project, rename to e.g. `BaseService` and adjust inheritance.

```ruby
class ApplicationService
  Result = Struct.new(:success, :value, :errors, keyword_init: true) do
    def success? = !!success
    def failure? = !success?
  end

  def self.call(...) = new(...).call

  private

  def success(value = nil)
    Result.new(success: true, value: value, errors: nil)
  end

  def failure(errors)
    Result.new(success: false, value: nil, errors: errors)
  end
end
```

### Composition

When one service calls another, **check the inner result** and propagate failures explicitly:

```ruby
def call
  user_result = Users::Create.call(params: @params)
  return user_result if user_result.failure?

  workspace_result = Workspaces::CreateDefault.call(user: user_result.value)
  return workspace_result if workspace_result.failure?

  success(user_result.value)
end
```

### Transactions across services

The **outermost service owns the transaction**. Inner services do not open their own — they assume the caller's transaction context. If an inner service must run in its own transaction (truly independent), document it in the class comment.

### Testing

- Test via `.call(...)` with realistic inputs.
- Assert on `result.success?`, `result.value`, `result.errors`.
- Stub repositories or external services (mailers, HTTP) when they are not the unit under test.

### Example

```ruby
class Users::Create < ApplicationService
  def initialize(params:)
    @form = Users::RegistrationForm.new(params)
  end

  def call
    return failure(@form.errors) unless @form.valid?

    user = ActiveRecord::Base.transaction do
      User.create!(@form.attributes.except(:password_confirmation, :terms_accepted))
    end

    success(user)
  end
end
```

Call site:

```ruby
result = Users::Create.call(params: user_params)

if result.success?
  redirect_to result.value
else
  render :new, locals: { errors: result.errors }
end
```

## 4. Repositories

Centralizes data access behind a named, intention-revealing API.

- **Use when**: a query has scoping/eager-loading rules that multiple callers need, or is reused across the codebase.
- **Don't use when**: you'd only wrap `Model.find(id)` 1:1 — that's noise, not abstraction.
- **Boundary**: **read-only.** Returns AR objects, relations, or value objects. No writes, no transactions, no business rules. Writes go through Services (which may call AR directly).
- **Naming**: `<Model>Repository`.
- **Convention — class methods, not instances.** Pass context (user, period, scope) as method parameters, not into a constructor. → `UserRepository.active(site: site)` shows the relevant input at the call site; instance state forces the reader to scroll back, and shared instances cause stale-state bugs.
- **Method count**: when a single method needs more than ~3 filter parameters, extract a Query Object instead.

### Testing

- Call methods directly (`UserRepository.active(...)`) with DB fixtures and assert on the returned relation/array.

### Example

```ruby
class UserRepository
  class << self
    def active(includes: [])
      User
        .where(active: true)
        .includes(includes)
        .order(:last_name, :first_name)
    end
  end
end
```

Call site: `UserRepository.active(includes: [:roles])`.

## 5. Query Objects

Encapsulates one read query, especially complex scopes, joins, or reporting logic.

- **Use when**: a query has filters, joins, or ordering beyond a one-liner; or it's reused.
- **Don't use when**: a single `where(...)` chain expresses intent clearly.
- **Boundary**: returns a relation or array. No writes, no side effects.
- **Naming**: `<Context>::<Adjective>Query` (e.g. `Users::ActiveQuery`).
- **Testing**: call `.call(...)` with DB fixtures; assert on the returned relation.

```ruby
class Users::ActiveQuery
  def call
    User.where(active: true).order(created_at: :desc)
  end
end
```

## 6. Form Objects

A PORO that captures and validates user input — independent of any AR model.

**Use when** any of these apply:
- The form spans multiple models (e.g. User + Address in one submit).
- Validation rules differ by context (registration vs. profile update).
- Inputs don't map to columns (`password_confirmation`, `terms_accepted`, virtual fields).
- You want view-/controller-specific validation out of the AR model.

**Don't use when**: a single AR model with its own validations covers the form 1:1.

- **Boundary**: knows nothing about persistence. Hands validated `attributes` to a service or repository.
- **Naming**: `<Context>::Form` or `<Context>::<Verb>Form`.
- **Testing**: instantiate with input, assert on `.valid?`, `.errors`, and `.attributes`.

```ruby
class Users::RegistrationForm
  include ActiveModel::Model
  include ActiveModel::Attributes

  attribute :email, :string
  attribute :password, :string
  attribute :password_confirmation, :string
  attribute :terms_accepted, :boolean

  validates :email, presence: true, format: URI::MailTo::EMAIL_REGEXP
  validates :password, length: { minimum: 8 }, confirmation: true
  validates :terms_accepted, acceptance: true
end
```

## 7. Anti-Patterns

### ❌ Fat callback in the model

```ruby
class User < ApplicationRecord
  after_create :send_welcome_email, :create_default_workspace, :sync_to_crm
end
```

**Why not**: side effects fire on every `User.create`, including factories and seeds. Hard to skip selectively. Order is implicit.

**✅ Instead**: extend the canonical `Users::Create` service (section 3) with the side effects after the transaction:

```ruby
def call
  return failure(@form.errors) unless @form.valid?

  user = ActiveRecord::Base.transaction do
    User.create!(@form.attributes.except(:password_confirmation, :terms_accepted))
  end

  WelcomeMailer.with(user: user).welcome.deliver_later
  Workspaces::CreateDefault.call(user: user)
  Crm::Sync.call(user: user)

  success(user)
end
```

Side effects fire only from this one explicit path. Tests can call `User.create!` directly without triggering them.

### ❌ Trivial repository wrapper

```ruby
class UserRepository
  def self.find(id) = User.find(id)
  def self.all      = User.all
  def self.first    = User.first
end
```

**Why not**: 1:1 forwards to AR add ceremony without abstraction. No scoping, no eager loading, no intent.

**✅ Instead**: only add methods that earn their place — see the `active` example in section 4. If callers just need `User.find(id)`, let them call AR directly.

### ❌ Context-dependent validation on the AR model

```ruby
class User < ApplicationRecord
  validates :password, presence: true, if: -> { context == :registration }
  validates :terms_accepted, acceptance: true, if: -> { context == :registration }

  attr_accessor :context, :terms_accepted
end
```

**Why not**: validation entangled with controller flow. The model sprouts virtual attributes that exist only for one form; other contexts can silently break the rules.

**✅ Instead**: a Form Object per context — see section 6. The AR model only enforces persistence invariants.

## 8. Tooling

- **`bullet`** — detect N+1 queries during development and tests.
- **`strong_migrations`** — block unsafe migrations (locking writes, missing FK index, `NOT NULL` columns without default, etc.). Also enforces the index-on-foreign-key rule.

## 9. Why a `Result` object instead of raising or returning the model

(Background for the convention in section 3.)

- **Explicit success/failure path** at the call site — callers can't accidentally treat a failed operation as a success.
- **No control flow via exceptions** for expected outcomes (validation errors are normal user input, not exceptional).
- **Uniform shape** — every controller and job handles every service the same way.
- **Errors travel with the result**, not as a side effect on the input form/model.
