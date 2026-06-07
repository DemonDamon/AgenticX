FROM golang:1.25-bookworm AS build
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /mock-upstream .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /mock-upstream /mock-upstream
EXPOSE 9099
ENTRYPOINT ["/mock-upstream", "-addr", ":9099"]
